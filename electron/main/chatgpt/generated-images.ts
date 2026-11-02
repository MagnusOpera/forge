import { readFileSync, statSync } from "node:fs";
import type { JsonObject } from "../../../shared/codex.js";
import {
  imageExtension,
  importAttachmentData,
  MAX_ATTACHMENT_BYTES,
} from "../codex/files.js";
import { text } from "../codex/client.js";

/** Runtime image events are consumed in main; only local attachment IDs reach the renderer. */
export function importGeneratedImage(root: string, item: JsonObject) {
  const result = text(item.result).replace(
    /^data:image\/[a-z0-9.+-]+;base64,/i,
    "",
  );
  let data: Buffer;
  if (result) {
    if (
      result.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(result)
    )
      throw new Error("The generated image is too large or invalid.");
    data = Buffer.from(result, "base64");
  } else if (text(item.savedPath)) {
    const file = text(item.savedPath);
    if (!statSync(file).isFile() || statSync(file).size > MAX_ATTACHMENT_BYTES)
      throw new Error("The generated image is too large or missing.");
    data = readFileSync(file);
  } else
    throw new Error(
      "OpenAI returned an image without readable image data. Update the Codex runtime and try again.",
    );
  const extension = imageExtension(data);
  if (!extension)
    throw new Error("OpenAI returned an unsupported image format.");
  return importAttachmentData(root, [
    { name: `Generated image${extension}`, data },
  ])[0];
}
