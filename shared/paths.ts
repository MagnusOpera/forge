function normalizedHome(home: string): string {
  if (!home.startsWith("/")) return "";
  return home.replace(/\/+$/, "") || "/";
}

/** Display-only: a sibling such as /Users/alice-other must never become ~. */
export function tildifyPath(value: string, home: string): string {
  const root = normalizedHome(home);
  if (!root || !value) return value;
  if (value === root) return "~";
  const prefix = root === "/" ? root : `${root}/`;
  return value.startsWith(prefix) ? `~/${value.slice(prefix.length)}` : value;
}

export function expandHomePath(value: string, home: string): string {
  const root = normalizedHome(home);
  if (!root) return value;
  if (value === "~") return root;
  return value.startsWith("~/") ? `${root === "/" ? "" : root}/${value.slice(2)}` : value;
}

/** Human prose/errors only. URLs, operation arguments and raw logs stay intact. */
export function tildifyPathText(value: string, home: string): string {
  const root = normalizedHome(home);
  if (!root || root === "/") return value;
  const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`(^|[\\s"'\x60(\\[{=])${escape(root)}(?=$|[/\\s"'\x60)\\]},;:])`, "g");
  return value.split(/(\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+)/gi)
    .map((part, index) => index % 2 ? part : part.replace(expression, "$1~"))
    .join("");
}
