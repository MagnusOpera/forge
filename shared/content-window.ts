export function isContentWindowName(name: string): boolean {
  return /^forge-content-pane-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(name);
}

/** Only the application's own content shell may open an attached native window. */
export function isContentWindowRequest(url: string, frameName: string, ownerUrl: string): boolean {
  if (!isContentWindowName(frameName)) return false;
  try {
    return url === new URL("content-window.html", ownerUrl).href;
  } catch { return false; }
}

export type PaneRectangle = { x: number; y: number; width: number; height: number };

/** Pass viewport CSS coordinates; the main process owns screen coordinates and zoom. */
export function contentPaneWindowFeatures(rect: PaneRectangle): string {
  return `popup,forgepanex=${rect.x},forgepaney=${rect.y},forgepanewidth=${rect.width},forgepaneheight=${rect.height}`;
}

export function contentPaneWindowBounds(features: string, content: PaneRectangle, zoom: number): PaneRectangle | null {
  const fields = new Map(features.split(",").map(field => {
    const [name, value] = field.trim().split("=");
    return [name.toLowerCase(), value] as const;
  }));
  const rect = {
    x: Number(fields.get("forgepanex")), y: Number(fields.get("forgepaney")),
    width: Number(fields.get("forgepanewidth")), height: Number(fields.get("forgepaneheight")),
  };
  if (![rect.x, rect.y, rect.width, rect.height, zoom].every(Number.isFinite) || zoom <= 0 || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 ||
    (rect.x + rect.width) * zoom > content.width + 2 || (rect.y + rect.height) * zoom > content.height + 2) return null;
  const x = Math.round(content.x + rect.x * zoom), y = Math.round(content.y + rect.y * zoom);
  return {
    x, y,
    width: Math.max(1, Math.round(content.x + (rect.x + rect.width) * zoom) - x),
    height: Math.max(1, Math.round(content.y + (rect.y + rect.height) * zoom) - y),
  };
}
