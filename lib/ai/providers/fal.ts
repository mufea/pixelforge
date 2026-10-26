import "server-only";

import sharp from "sharp";
import { getFalCredentials } from "@/lib/ai/config";
import { subscribeFal } from "@/lib/ai/providers/fal-client";
import type {
  EditInput,
  GenerateInput,
  ImageOperation,
  ImageToImageInput,
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
/** Official Fal image-editing model: prompt + image_url. No mask parameter. */
export const FAL_EDIT_MODEL = "fal-ai/flux-kontext/dev";
/** Official Fal image-to-image model: prompt + image_url + optional strength 0.01–1. */
export const FAL_IMAGE_TO_IMAGE_MODEL = "fal-ai/flux/dev/image-to-image";

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
  return runFalImageJob(FAL_GENERATE_MODEL, { prompt: input.prompt }, signal);
}

export async function falEdit(input: EditInput, signal: AbortSignal): Promise<ProviderResult> {
  const prompt = input.prompt.trim();
  if (prompt.length < 3) {
    throw new DomainError("VALIDATION", "Prompt must be at least 3 characters");
  }
  if (input.mask) {
    throw new DomainError(
      "MODEL_CAPABILITY_UNSUPPORTED",
      "Fal flux-kontext/dev does not accept a mask. Use OpenAI or Stability inpaint for masked edits.",
      400,
    );
  }
  const mime = requireFalSourceMime(input.image, input.mimeType);
  return runFalImageJob(
    FAL_EDIT_MODEL,
    { prompt, image_url: toDataUri(input.image, mime), output_format: "png" },
    signal,
  );
}

export async function falImageToImage(input: ImageToImageInput, signal: AbortSignal): Promise<ProviderResult> {
  const prompt = input.prompt.trim();
  if (prompt.length < 3) {
    throw new DomainError("VALIDATION", "Prompt must be at least 3 characters");
  }
  const mime = requireFalSourceMime(input.image, input.mimeType);
  const payload: Record<string, unknown> = {
    prompt,
    image_url: toDataUri(input.image, mime),
    output_format: "png",
  };
  if (input.strength !== undefined) {
    if (!Number.isFinite(input.strength) || input.strength < 0.01 || input.strength > 1) {
      throw new DomainError("VALIDATION", "strength must be between 0.01 and 1");
    }
    payload.strength = input.strength;
  }
  return runFalImageJob(FAL_IMAGE_TO_IMAGE_MODEL, payload, signal);
}

export async function falRemoveBackground(
  input: RemoveBackgroundInput,
  signal: AbortSignal,
): Promise<ProviderResult> {
  const mime = requireFalSourceMime(input.image, input.mimeType);
  return runFalImageJob(FAL_BACKGROUND_MODEL, { image_url: toDataUri(input.image, mime) }, signal);
}

export async function falUpscale(input: UpscaleInput, signal: AbortSignal): Promise<ProviderResult> {
  if (input.scaleFactor !== 2 && input.scaleFactor !== 3 && input.scaleFactor !== 4) {
    throw new DomainError("UNSUPPORTED_UPSCALE_FACTOR", "Upscale factor must be 2, 3, or 4");
  }
  const mime = requireFalSourceMime(input.image, input.mimeType);
  return runFalImageJob(
    FAL_UPSCALE_MODEL,
    { image_url: toDataUri(input.image, mime), upscale_factor: input.scaleFactor },
    signal,
  );
}

export async function falRemoveObject(input: RemoveObjectInput, signal: AbortSignal): Promise<ProviderResult> {
  const mime = requireFalSourceMime(input.image, input.mimeType);
  if (detectImageMime(input.mask) !== "image/png") {
    throw new DomainError("VALIDATION_INVALID_MIME", "Object removal masks must be PNG images");
  }
  return runFalImageJob(
    FAL_OBJECT_REMOVAL_MODEL,
    {
      image_url: toDataUri(input.image, mime),
      mask_url: toDataUri(input.mask, "image/png"),
    },
    signal,
  );
}

async function runFalImageJob(
  modelId: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ProviderResult> {
  getFalCredentials();
  const started = Date.now();
  const payload = await subscribeFal(modelId, input, signal);
  const bytes = await readFalImageBytes(firstFalImage(asFalPayload(payload.data)), signal);
  const metadata = await inspectFalImage(bytes);
  return {
    images: [{ bytes, mimeType: metadata.mimeType, width: metadata.width, height: metadata.height }],
    providerRequestId: payload.requestId,
    latencyMs: Date.now() - started,
    rawModel: modelId,
  };
}

function requireFalSourceMime(image: Buffer, mimeType?: string) {
  const mime = mimeType ?? detectImageMime(image);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }
  return mime;
}

function toDataUri(bytes: Buffer, mime: string) {
  return `data:${mime};base64,${bytes.toString("base64")}`;
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
