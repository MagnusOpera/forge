export async function chatAttachmentData(files: File[]) {
  if (files.length > 20 || files.some((file) => file.size > 20 * 1024 * 1024))
    throw new Error("Attach up to 20 files of 20 MB or smaller.");
  return Promise.all(
    files.map(async (file) => {
      const buffer =
        typeof file.arrayBuffer === "function"
          ? await file.arrayBuffer()
          : await new Promise<ArrayBuffer>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as ArrayBuffer);
              reader.onerror = () =>
                reject(
                  reader.error ?? new Error(`Unable to read ${file.name}.`),
                );
              reader.onabort = () =>
                reject(new Error(`Reading ${file.name} was cancelled.`));
              reader.readAsArrayBuffer(file);
            });
      return { name: file.name, data: new Uint8Array(buffer) };
    }),
  );
}
