import { expandHomePath, tildifyPath, tildifyPathText } from "../shared/paths";
let homeDirectory = "";

export async function initializeDisplayPaths(): Promise<void> {
  try {
    const context = await window.forgeCodex?.request("displayContext", {});
    homeDirectory = context?.platform === "win32" ? "" : context?.homeDirectory ?? "";
  } catch {
    homeDirectory = "";
  }
}
export const displayPath = (value: string, remote = false): string => remote ? value : tildifyPath(value, homeDirectory);
export const displayPathText = (value: string, remote = false): string => remote ? value : tildifyPathText(value, homeDirectory);
export const expandDisplayPath = (value: string): string => expandHomePath(value, homeDirectory);
