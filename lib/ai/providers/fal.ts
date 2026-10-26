import "server-only";

import sharp from "sharp";
import { getFalCredentials } from "@/lib/ai/config";
import { subscribeFal } from "@/lib/ai/providers/fal-client";
import type {
  GenerateInput,
  ImageOperation,
  ProviderResult,
  RemoveBackgroundInput,
  RemoveObjectInput,
  UpscaleInput,
} from "@/lib/ai/types";
import { detectImageMime } from "@/lib/assets/mime";
import { DomainError } from "@/lib/errors";
import { domainErrorFromProviderResponse, normalizeProviderError } from "@/lib/ai/errors";

export const FAL_BACKGROUND_MODEL = "fal-ai/bria/background/remove";
export const FAL_UPSCALE_MODEL = "fal-ai/flux-vision-upscaler";
export const FAL_OBJECT_REMOVAL_MODEL = "fal-ai/object-removal/mask";
export const FAL_GENERATE_MODEL = "fal-ai/flux/schnell";

type FalImageField = { url?: string; content?: string; file_data?: string; width?: number; height?: number };

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

export async function falGenerate(input: GenerateInput, signal: AbortSignal): Promise<ProviderResult> {
  getFalCredentials();
  const started = Date.now();
  const payload = await subscribeFal(FAL_GENERATE_MODEL, { prompt: input.prompt }, signal);
  const bytes = await readFalImageBytes(firstFalImage(asFalPayload(payload.data)), signal);
  const metadata = await inspectFalImage(bytes);
  return {
    images: [{ bytes, mimeType: metadata.mimeType, width: metadata.width, height: metadata.height }],
    providerRequestId: payload.requestId,
    latencyMs: Date.now() - started,
    rawModel: FAL_GENERATE_MODEL,
  };
}

export async function falRemoveBackground(
  input: RemoveBackgroundInput,
  signal: AbortSignal,
): Promise<ProviderResult> {
  const mime = input.mimeType ?? detectImageMime(input.image);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }

  getFalCredentials();
  const started = Date.now();
  const dataUri = `data:${mime};base64,${input.image.toString("base64")}`;
  const payload = await subscribeFal(FAL_BACKGROUND_MODEL, { image_url: dataUri }, signal);
  const bytes = await readFalImageBytes(firstFalImage(asFalPayload(payload.data)), signal);
  const metadata = await inspectFalImage(bytes);

  return {
    images: [{ bytes, mimeType: metadata.mimeType, width: metadata.width, height: metadata.height }],
    providerRequestId: payload.requestId,
    latencyMs: Date.now() - started,
    rawModel: FAL_BACKGROUND_MODEL,
  };
}

export async function falUpscale(input: UpscaleInput, signal: AbortSignal): Promise<ProviderResult> {
  if (input.scaleFactor !== 2 && input.scaleFactor !== 3 && input.scaleFactor !== 4) {
    throw new DomainError("UNSUPPORTED_UPSCALE_FACTOR", "Upscale factor must be 2, 3, or 4");
  }
  const mime = input.mimeType ?? detectImageMime(input.image);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }

  getFalCredentials();
  const started = Date.now();
  const dataUri = `data:${mime};base64,${input.image.toString("base64")}`;
  const payload = await subscribeFal(
    FAL_UPSCALE_MODEL,
    { image_url: dataUri, upscale_factor: input.scaleFactor },
    signal,
  );
  const bytes = await readFalImageBytes(firstFalImage(asFalPayload(payload.data)), signal);
  const metadata = await inspectFalImage(bytes);

  return {
    images: [{ bytes, mimeType: metadata.mimeType, width: metadata.width, height: metadata.height }],
    providerRequestId: payload.requestId,
    latencyMs: Date.now() - started,
    rawModel: FAL_UPSCALE_MODEL,
  };
}

export async function falRemoveObject(input: RemoveObjectInput, signal: AbortSignal): Promise<ProviderResult> {
  const mime = input.mimeType ?? detectImageMime(input.image);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }
  if (detectImageMime(input.mask) !== "image/png") {
    throw new DomainError("VALIDATION_INVALID_MIME", "Object removal masks must be PNG images");
  }

  getFalCredentials();
  const started = Date.now();
  const imageUri = `data:${mime};base64,${input.image.toString("base64")}`;
  const maskUri = `data:image/png;base64,${input.mask.toString("base64")}`;
  const payload = await subscribeFal(
    FAL_OBJECT_REMOVAL_MODEL,
    { image_url: imageUri, mask_url: maskUri },
    signal,
  );
  const bytes = await readFalImageBytes(firstFalImage(asFalPayload(payload.data)), signal);
  const metadata = await inspectFalImage(bytes);

  return {
    images: [{ bytes, mimeType: metadata.mimeType, width: metadata.width, height: metadata.height }],
    providerRequestId: payload.requestId,
    latencyMs: Date.now() - started,
    rawModel: FAL_OBJECT_REMOVAL_MODEL,
  };
}

function asFalPayload(data: unknown): { image?: FalImageField; images?: FalImageField[] } {
  if (!data || typeof data !== "object") {
    return {};
  }
  return data as { image?: FalImageField; images?: FalImageField[] };
}

function firstFalImage(payload: { image?: FalImageField; images?: FalImageField[] }) {
  return payload.image ?? payload.images?.[0];
}

async function readFalImageBytes(image: FalImageField | undefined, signal: AbortSignal): Promise<Buffer> {
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

async function inspectFalImage(bytes: Buffer) {
  const mimeType = detectImageMime(bytes);
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not return a JPEG, PNG, or WebP image", 502);
  }
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 1 || height < 1) {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not return image bytes", 502);
  }
  return { mimeType, width, height };
}
