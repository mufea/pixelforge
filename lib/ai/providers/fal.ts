import "server-only";

import sharp from "sharp";
import { getFalCredentials } from "@/lib/ai/config";
import { domainErrorFromProviderResponse, normalizeProviderError } from "@/lib/ai/errors";
import type { ImageOperation, ProviderResult, RemoveBackgroundInput } from "@/lib/ai/types";
import { detectImageMime } from "@/lib/assets/mime";
import { DomainError } from "@/lib/errors";

export const FAL_BACKGROUND_MODEL = "fal-ai/bria/background/remove";
const FAL_RUN_ORIGIN = "https://fal.run";

/**
 * Remaining Fal operations stay catalog stubs until later slices. They never fetch.
 */
export function falUnimplemented(operation: ImageOperation): never {
  throw new DomainError(
    "MODEL_CAPABILITY_UNSUPPORTED",
    `Fal ${operation} is not implemented`,
    400,
  );
}

export function isAllowedFalResultUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  return parsed.hostname === "fal.media" || parsed.hostname.endsWith(".fal.media");
}

export async function falRemoveBackground(
  input: RemoveBackgroundInput,
  signal: AbortSignal,
): Promise<ProviderResult> {
  const credentials = getFalCredentials();
  const mime = input.mimeType ?? detectImageMime(input.image);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }

  const started = Date.now();
  const dataUri = `data:${mime};base64,${input.image.toString("base64")}`;
  let response: Response;
  try {
    response = await fetch(`${FAL_RUN_ORIGIN}/${FAL_BACKGROUND_MODEL}`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Key ${credentials.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image_url: dataUri }),
    });
  } catch (error) {
    throw normalizeProviderError(error);
  }

  if (!response.ok) {
    throw await domainErrorFromProviderResponse(response);
  }

  const payload = (await response.json()) as {
    image?: { url?: string; content?: string; file_data?: string; width?: number; height?: number };
    request_id?: string;
  };
  const bytes = await readFalImageBytes(payload.image, signal);
  const metadata = await inspectPng(bytes);

  return {
    images: [{ bytes, mimeType: "image/png", width: metadata.width, height: metadata.height }],
    providerRequestId: payload.request_id,
    latencyMs: Date.now() - started,
    rawModel: FAL_BACKGROUND_MODEL,
  };
}

async function readFalImageBytes(
  image: { url?: string; content?: string; file_data?: string } | undefined,
  signal: AbortSignal,
): Promise<Buffer> {
  const inline = image?.content ?? image?.file_data;
  if (typeof inline === "string" && inline.length > 0) {
    return Buffer.from(inline, "base64");
  }
  const url = image?.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not return image bytes", 502);
  }
  if (url.startsWith("data:image/png;base64,")) {
    return Buffer.from(url.slice("data:image/png;base64,".length), "base64");
  }
  if (!isAllowedFalResultUrl(url)) {
    throw new DomainError("PROVIDER_REJECTED", "The image provider returned an untrusted result URL", 502);
  }

  let download: Response;
  try {
    download = await fetch(url, { signal });
  } catch (error) {
    throw normalizeProviderError(error);
  }
  if (!download.ok) {
    throw await domainErrorFromProviderResponse(download);
  }
  return Buffer.from(await download.arrayBuffer());
}

async function inspectPng(bytes: Buffer) {
  if (detectImageMime(bytes) !== "image/png") {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not return a PNG", 502);
  }
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 1 || height < 1) {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not return image bytes", 502);
  }
  return { width, height };
}
