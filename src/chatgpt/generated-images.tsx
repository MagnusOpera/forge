import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import type { ChatApi } from "../../shared/chatgpt";
import type { CodexAttachment } from "../../shared/codex";

export function ChatGeneratedImage({
  api,
  threadId,
  image,
  onError,
}: {
  api: ChatApi;
  threadId: string;
  image: CodexAttachment;
  onError(message: string): void;
}) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const errorHandler = useRef(onError);
  useEffect(() => {
    errorHandler.current = onError;
  }, [onError]);
  useEffect(() => {
    let active = true;
    setSource("");
    setFailed(false);
    void api
      .request("attachmentImage", { id: threadId, attachmentId: image.id })
      .then((source) => {
        if (active) setSource(source);
      })
      .catch((error) => {
        if (active) {
          setFailed(true);
          errorHandler.current(
            error instanceof Error
              ? error.message
              : "Unable to load the generated image.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [api, threadId, image.id]);
  const action = (method: "openAttachment" | "saveAttachment") =>
    void api
      .request(method, { id: threadId, attachmentId: image.id })
      .catch((error) =>
        errorHandler.current(
          error instanceof Error ? error.message : "Unable to open the image.",
        ),
      );
  return (
    <figure className="chatgpt-generated-image">
      {failed ? (
        <span>Image unavailable</span>
      ) : source ? (
        <img
          src={source}
          alt={image.name}
          onError={() => {
            setFailed(true);
            errorHandler.current("Unable to display the generated image.");
          }}
        />
      ) : (
        <Loader2
          size={20}
          className="spin"
          aria-label="Loading generated image"
        />
      )}
      <figcaption>
        <button
          type="button"
          className="ghost-button"
          onClick={() => action("openAttachment")}
        >
          <ExternalLink size={14} />
          Open image
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => action("saveAttachment")}
        >
          <Download size={14} />
          Save image
        </button>
      </figcaption>
    </figure>
  );
}
