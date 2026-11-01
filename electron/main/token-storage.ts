import type { SafeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

type AsyncSafeStorage = Pick<SafeStorage,
  "isAsyncEncryptionAvailable" | "encryptStringAsync" | "decryptStringAsync"
>;

export async function readStoredToken(filePath: string, storage: AsyncSafeStorage): Promise<string | null> {
  let encrypted: Buffer;
  try {
    encrypted = await fs.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  if (!(await storage.isAsyncEncryptionAvailable())) {
    throw new Error("Secure storage is not available on this machine.");
  }
  const { result, shouldReEncrypt } = await storage.decryptStringAsync(encrypted);
  if (shouldReEncrypt) {
    await writeStoredToken(filePath, result, storage);
  }
  return result;
}

export async function writeStoredToken(filePath: string, token: string, storage: AsyncSafeStorage): Promise<void> {
  if (!(await storage.isAsyncEncryptionAvailable())) {
    throw new Error("Secure token storage is not available.");
  }

  const encrypted = await storage.encryptStringAsync(token);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, encrypted, { mode: 0o600 });
}
