import { createContext, useContext } from "react";

export type PaneSurface = { document: Document; window: Window; portalRoot: HTMLElement | null };
export const PaneSurfaceContext = createContext<PaneSurface | null>(null);
/** DOM events and overlays must follow the pane into its current native window. */
export function usePaneSurface(): PaneSurface {
  return useContext(PaneSurfaceContext) ?? { document: globalThis.document, window: globalThis.window, portalRoot: null };
}
