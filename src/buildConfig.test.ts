import { describe, expect, it } from "vitest";
import { createServer } from "vite";
import { parseSync, transformAsync, traverse } from "@babel/core";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { LoggerEvent } from "babel-plugin-react-compiler";
import viteConfig, { reactCompilerOptions } from "../vite.config";

describe("viteConfig", () => {
  it("emits relative asset paths for packaged Electron file URLs", () => {
    expect(viteConfig).toMatchObject({ base: "./" });
  });
  it("compiles renderer components with automatic memoization", async () => {
    const server = await createServer({
      ...viteConfig,
      configFile: false,
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const result = await server.transformRequest("/src/App.tsx");
      expect(result?.code).toMatch(/react[\/_]compiler-runtime/);
      expect(result?.code).toContain("react.memo_cache_sentinel");
    } finally {
      await server.close();
    }
  });
  it("has no compiler diagnostics outside documented function opt-outs", async () => {
    const src = fileURLToPath(new URL(".", import.meta.url));
    let compiled = 0;
    for (const relative of readdirSync(src, { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/.test(relative) || /\.(test|d)\.tsx?$/.test(relative)) continue;
      const filename = path.join(src, relative);
      const source = readFileSync(filename, "utf8");
      const parserOpts = { plugins: ["typescript", "jsx"] as ["typescript", "jsx"] };
      const ast = parseSync(source, { filename, configFile: false, babelrc: false, parserOpts });
      const optedOut = new Set<string>();
      if (ast) traverse(ast, {
        Function({ node }) {
          if (node.body.type === "BlockStatement" && node.body.directives.some(d => d.value.value === "use no memo")) {
            optedOut.add(`${node.loc?.start.line}:${node.loc?.start.column}`);
          }
        },
      });
      await transformAsync(source, {
        filename, configFile: false, babelrc: false, parserOpts,
        plugins: [["babel-plugin-react-compiler", {
          ...reactCompilerOptions,
          logger: {
            logEvent(_filename: string | null, event: LoggerEvent) {
              if (event.kind === "CompileSuccess") compiled++;
              if (!["CompileError", "CompileDiagnostic", "PipelineError"].includes(event.kind)) return;
              const loc = "fnLoc" in event ? event.fnLoc?.start : null;
              // The compiler analyzes opted-out functions too; their diagnostics
              // do not affect compilation because their original code is retained.
              if (loc && optedOut.has(`${loc.line}:${loc.column}`)) return;
              throw new Error(`React Compiler diagnostic in ${filename}: ${JSON.stringify(event)}`);
            },
          },
        }]],
      });
    }
    expect(compiled).toBeGreaterThan(0);
  }, 15000);
});
