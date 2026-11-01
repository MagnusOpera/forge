import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredToken, writeStoredToken } from "../electron/main/token-storage";

describe("async token storage", () => {
  let directory: string;
  let filePath: string;
  const encrypted = Buffer.from("encrypted-token");
  const storage = {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (_token: string) => encrypted),
    decryptStringAsync: vi.fn(async (_encrypted: Buffer) => ({ result: "ghp_saved", shouldReEncrypt: false }))
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    storage.isAsyncEncryptionAvailable.mockResolvedValue(true);
    storage.encryptStringAsync.mockResolvedValue(encrypted);
    storage.decryptStringAsync.mockResolvedValue({ result: "ghp_saved", shouldReEncrypt: false });
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "forge-token-"));
    filePath = path.join(directory, "user-data", "github-token.bin");
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("returns null for a missing token without initializing encryption", async () => {
    expect(await readStoredToken(filePath, storage)).toBeNull();
    expect(storage.isAsyncEncryptionAvailable).not.toHaveBeenCalled();
  });

  it("writes encrypted bytes with private permissions and reads the decrypted result", async () => {
    await writeStoredToken(filePath, "ghp_saved", storage);
    expect(storage.encryptStringAsync).toHaveBeenCalledWith("ghp_saved");
    expect(await fs.readFile(filePath)).toEqual(encrypted);
    if (process.platform !== "win32") {
      expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
    }
    expect(await readStoredToken(filePath, storage)).toBe("ghp_saved");
    expect(storage.decryptStringAsync).toHaveBeenCalledWith(encrypted);
    expect(storage.encryptStringAsync).toHaveBeenCalledTimes(1);
  });

  it("refreshes stored encryption when the decryptor requests key rotation", async () => {
    await writeStoredToken(filePath, "ghp_saved", storage);
    storage.decryptStringAsync.mockResolvedValue({ result: "ghp_saved", shouldReEncrypt: true });
    storage.encryptStringAsync.mockResolvedValue(Buffer.from("rotated-token"));
    expect(await readStoredToken(filePath, storage)).toBe("ghp_saved");
    expect(await fs.readFile(filePath)).toEqual(Buffer.from("rotated-token"));
  });

  it("rejects unavailable storage before decrypting or overwriting a token", async () => {
    await writeStoredToken(filePath, "ghp_saved", storage);
    storage.isAsyncEncryptionAvailable.mockResolvedValue(false);
    await expect(readStoredToken(filePath, storage)).rejects.toThrow("Secure storage is not available");
    await expect(writeStoredToken(filePath, "ghp_new", storage)).rejects.toThrow("Secure token storage is not available");
    expect(storage.decryptStringAsync).not.toHaveBeenCalled();
    expect(await fs.readFile(filePath)).toEqual(encrypted);
  });

  it("propagates decryption failures instead of treating them as missing credentials", async () => {
    await writeStoredToken(filePath, "ghp_saved", storage);
    const error = new Error("Keychain temporarily unavailable");
    storage.decryptStringAsync.mockRejectedValue(error);
    await expect(readStoredToken(filePath, storage)).rejects.toBe(error);
    expect(await fs.readFile(filePath)).toEqual(encrypted);
  });
});
