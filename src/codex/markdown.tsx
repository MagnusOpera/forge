import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import DOMPurify from "dompurify";
import { codexApi, errorMessage } from "./api";

export function isLocalFileLink(href: string): boolean {
  return (
    Boolean(href) &&
    !href.startsWith("#") &&
    (!/^[a-z][a-z\d+.-]*:/i.test(href) || /^(file:|sandbox:\/)/i.test(href))
  );
}
export function markdownUrl(href: string): string {
  return isLocalFileLink(href) ? href : defaultUrlTransform(href);
}
function downloadText(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Mermaid has global configuration. Serialize renders so different messages and
// theme changes cannot alter another diagram's in-flight configuration.
let renders: Promise<unknown> = Promise.resolve();
let diagramId = 0;
function Mermaid({ source }: { source: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const shell = root.current?.closest("[data-theme]");
    const update = () => setDark(shell?.getAttribute("data-theme") === "dark");
    update();
    const observer = new MutationObserver(update);
    if (shell)
      observer.observe(shell, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    setSvg("");
    setError("");
    renders = renders
      .catch(() => undefined)
      .then(async () => {
        if (!alive) return;
        try {
          const { default: mermaid } = await import("mermaid");
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: dark ? "dark" : "default",
            suppressErrorRendering: true,
            htmlLabels: false,
            flowchart: { htmlLabels: false },
          });
          const result = await mermaid.render(
            `forge-diagram-${++diagramId}`,
            source,
          );
          const safe = DOMPurify.sanitize(result.svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ["foreignObject", "image", "a"],
            FORBID_ATTR: ["href", "xlink:href", "src", "onload"],
          });
          if (alive) setSvg(safe);
        } catch {
          if (alive)
            setError(
              "Diagram is incomplete or invalid. Showing Mermaid source.",
            );
        }
      });
    return () => {
      alive = false;
    };
  }, [source, dark]);
  return (
    <div ref={root} className="codex-mermaid">
      {svg ? (
        <>
          <div
            className="codex-diagram-image"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <button
            className="ghost-button"
            onClick={() => downloadText(svg, "diagram.svg", "image/svg+xml")}
          >
            Save SVG
          </button>
        </>
      ) : (
        <p className="codex-muted">{error || "Rendering diagram…"}</p>
      )}
      <details open={Boolean(error)}>
        <summary>Mermaid source</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </div>
  );
}

type Context = {
  repositoryId: string;
  id: string;
  onError: (message: string) => void;
};
function LocalImage({
  href,
  alt,
  context,
}: {
  href: string;
  alt: string;
  context: Context;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    codexApi()
      .request("outputFile", {
        repositoryId: context.repositoryId,
        id: context.id,
        href,
        action: "image",
      })
      .then((value) => {
        if (alive) setSrc(value);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [href, context.repositoryId, context.id]);
  return src ? (
    <img src={src} alt={alt} loading="lazy" />
  ) : (
    <span>
      {failed ? `[Image unavailable: ${alt || href}]` : "Loading image…"}
    </span>
  );
}
function FileLink({
  href,
  children,
  context,
}: {
  href: string;
  children: ReactNode;
  context: Context;
}) {
  const action = (value: "reveal" | "save") =>
    void codexApi()
      .request("outputFile", {
        repositoryId: context.repositoryId,
        id: context.id,
        href,
        action: value,
      })
      .catch((error) => context.onError(errorMessage(error)));
  return (
    <span className="codex-file-link">
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          action("reveal");
        }}
        title="Show in Finder"
      >
        {children}
      </a>
      <button
        className="icon-button"
        title="Save a copy"
        aria-label={`Download ${typeof children === "string" ? children : "document"}`}
        onClick={() => action("save")}
      >
        ↓
      </button>
    </span>
  );
}
export const CodexMarkdown = memo(function CodexMarkdown({
  text,
  ...context
}: Context & { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      urlTransform={markdownUrl}
      components={{
        a: ({ href = "", children }) =>
          isLocalFileLink(href) ? (
            <FileLink href={href} context={context}>
              {children}
            </FileLink>
          ) : (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (/^https?:\/\//i.test(href))
                  void codexApi()
                    .request("openLink", { url: href })
                    .catch((error) => context.onError(errorMessage(error)));
              }}
            >
              {children}
            </a>
          ),
        img: ({ src, alt = "" }) =>
          typeof src === "string" && isLocalFileLink(src) ? (
            <LocalImage href={src} alt={alt} context={context} />
          ) : typeof src === "string" && /^https?:\/\//i.test(src) ? (
            <img
              src={src}
              alt={alt}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span>[Image: {alt}]</span>
          ),
        pre: ({ children, node }) => {
          const code = node?.children[0];
          if (
            code?.type === "element" &&
            code.tagName === "code" &&
            Array.isArray(code.properties.className) &&
            code.properties.className.includes("language-mermaid")
          ) {
            const source = code.children
              .map((child) => (child.type === "text" ? child.value : ""))
              .join("");
            return <Mermaid source={source} />;
          }
          return <pre>{children}</pre>;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
});
export function DownloadMessage({ text }: { text: string }) {
  return (
    <button
      className="icon-button"
      title="Download Markdown"
      aria-label="Download message as Markdown"
      onClick={() =>
        downloadText(text, "codex-message.md", "text/markdown;charset=utf-8")
      }
    >
      ↓
    </button>
  );
}
