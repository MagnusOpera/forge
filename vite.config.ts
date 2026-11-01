import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

// Fail on diagnostics in compiled functions; explicitly opted-out functions retain their behavior.
export const reactCompilerOptions = { panicThreshold: "all_errors" } as const;

export default defineConfig({
  base: "./",
  plugins: [react(), babel({
    presets: [reactCompilerPreset(reactCompilerOptions)],
    // Test harnesses deliberately expose render state to their assertions.
    exclude: [/[\\/]node_modules[\\/]/, /\.test\.[jt]sx?$/],
  })],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    rolldownOptions: { input: { main: "index.html", content: "content-window.html" } }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});
