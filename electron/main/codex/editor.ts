import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_TEXT_EDITOR } from "../../../shared/codex.js";

const exec = promisify(execFile);
export function validateEditor(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\0\r\n]/.test(value)
  )
    throw new Error("Invalid text editor application.");
  const editor = value.trim() || DEFAULT_TEXT_EDITOR;
  if (
    editor.startsWith("-") ||
    (editor.includes("/") &&
      (!path.isAbsolute(editor) || !editor.endsWith(".app")))
  )
    throw new Error(
      "Choose an application name or an absolute .app path for the text editor.",
    );
  return editor;
}
export function editorOpenArguments(editor: string, folder: string): string[] {
  if (!path.isAbsolute(folder) || folder.includes("\0"))
    throw new Error("Invalid editor folder.");
  return ["-a", validateEditor(editor), folder];
}
export async function openInTextEditor(
  folder: string,
  editor: string,
  launch: (
    file: string,
    args: string[],
    options: { timeout: number },
  ) => Promise<unknown> = exec,
): Promise<void> {
  const args = editorOpenArguments(editor, folder);
  try {
    await launch("/usr/bin/open", args, { timeout: 10_000 });
  } catch {
    throw new Error(
      `Could not open ${args[1]}. Install the editor or choose its application in global configuration.`,
    );
  }
}
