import "server-only";

import sharp from "sharp";
import { getStabilityCredentials } from "@/lib/ai/config";
import { domainErrorFromProviderResponse, normalizeProviderError } from "@/lib/ai/errors";
import type {
  EditInput,
  GenerateInput,
  ProviderResult,
  RemoveBackgroundInput,
  RemoveObjectInput,
  UpscaleInput,
} from "@/lib/ai/types";
import { detectImageMime } from "@/lib/assets/mime";
import { DomainError } from "@/lib/errors";

export const STABILITY_GENERATE_MODEL = "stability-image-ultra";
export const STABILITY_EDIT_MODEL = "stability-image-inpaint";
export const STABILITY_REMOVE_BACKGROUND_MODEL = "stability-remove-background";
export const STABILITY_OBJECT_REMOVAL_MODEL = "stability-erase";
export const STABILITY_UPSCALE_MODEL = "stability-upscale-fast";

const PATHS = {
  generate: "/v2beta/stable-image/generate/ultra",
  edit: "/v2beta/stable-image/edit/inpaint",
  removeBackground: "/v2beta/stable-image/edit/remove-background",
  erase: "/v2beta/stable-image/edit/erase",
  upscale: "/v2beta/stable-image/upscale/fast",
} as const;

type StabilityJson = {
  image?: string;
  finish_reason?: string;
  seed?: number;
};

function requireImageMime(bytes: Buffer, fallback?: string) {
  const mime = fallback ?? detectImageMime(bytes);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }
  return mime;
}

export async function stabilityGenerate(input: GenerateInput, signal: AbortSignal): Promise<ProviderResult> {
  const form = new FormData();
  form.set("prompt", input.prompt);
  form.set("output_format", "png");
  return requestStability(PATHS.generate, form, signal, STABILITY_GENERATE_MODEL);
}

export async function stabilityEdit(input: EditInput, signal: AbortSignal): Promise<ProviderResult> {
  const mime = requireImageMime(input.image, input.mimeType);
  const form = new FormData();
  form.set("prompt", input.prompt);
  form.set("output_format", "png");
  form.set("image", new Blob([Uint8Array.from(input.image)], { type: mime }), fileNameForMime(mime));
  if (input.mask) {
    if (detectImageMime(input.mask) !== "image/png") {
      throw new DomainError("VALIDATION_INVALID_MIME", "Edit masks must be PNG images");
    }
    form.set("mask", new Blob([Uint8Array.from(input.mask)], { type: "image/png" }), "mask.png");
  }
  return requestStability(PATHS.edit, form, signal, STABILITY_EDIT_MODEL);
}

export async function stabilityRemoveBackground(
  input: RemoveBackgroundInput,
  signal: AbortSignal,
): Promise<ProviderResult> {
  const mime = requireImageMime(input.image, input.mimeType);
  const form = new FormData();
  form.set("output_format", "png");
  form.set("image", new Blob([Uint8Array.from(input.image)], { type: mime }), fileNameForMime(mime));
  return requestStability(PATHS.removeBackground, form, signal, STABILITY_REMOVE_BACKGROUND_MODEL);
}

export async function stabilityRemoveObject(input: RemoveObjectInput, signal: AbortSignal): Promise<ProviderResult> {
  const mime = requireImageMime(input.image, input.mimeType);
  if (detectImageMime(input.mask) !== "image/png") {
    throw new DomainError("VALIDATION_INVALID_MIME", "Object removal masks must be PNG images");
  }
  const form = new FormData();
  form.set("output_format", "png");
  form.set("image", new Blob([Uint8Array.from(input.image)], { type: mime }), fileNameForMime(mime));
  form.set("mask", new Blob([Uint8Array.from(input.mask)], { type: "image/png" }), "mask.png");
  return requestStability(PATHS.erase, form, signal, STABILITY_OBJECT_REMOVAL_MODEL);
}

export async function stabilityUpscale(input: UpscaleInput, signal: AbortSignal): Promise<ProviderResult> {
  if (input.scaleFactor !== 4) {
    throw new DomainError(
      "UNSUPPORTED_UPSCALE_FACTOR",
      "Stability Fast Upscaler only supports a 4× scale factor",
    );
  }
  const mime = requireImageMime(input.image, input.mimeType);
  const form = new FormData();
  form.set("output_format", "png");
  form.set("image", new Blob([Uint8Array.from(input.image)], { type: mime }), fileNameForMime(mime));
  return requestStability(PATHS.upscale, form, signal, STABILITY_UPSCALE_MODEL);
}

async function requestStability(
  path: string,
  form: FormData,
  signal: AbortSignal,
  rawModel: string,
): Promise<ProviderResult> {
  const credentials = getStabilityCredentials();
  const started = Date.now();
  const url = `${credentials.baseUrl.replace(/\/$/, "")}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        Accept: "application/json",
      },
      body: form,
    });
  } catch (error) {
    throw normalizeProviderError(error);
  }

  if (!response.ok) {
    throw await domainErrorFromProviderResponse(response);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let bytes: Buffer;
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as StabilityJson;
    if (payload.finish_reason === "CONTENT_FILTERED") {
      throw new DomainError("SAFETY_REJECTED", "The image provider rejected the request for safety reasons", 400);
    }
    if (typeof payload.image !== "string" || payload.image.length === 0) {
      throw new DomainError("PROVIDER_REJECTED", "The image provider did not return image bytes", 502);
    }
    bytes = Buffer.from(payload.image, "base64");
  } else if (contentType.startsWith("image/")) {
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not return image bytes", 502);
  }

  const metadata = await inspectStabilityImage(bytes);
  return {
    images: [{ bytes, mimeType: metadata.mimeType, width: metadata.width, height: metadata.height }],
    providerRequestId: response.headers.get("x-request-id") ?? undefined,
    latencyMs: Date.now() - started,
    rawModel,
  };
}

async function inspectStabilityImage(bytes: Buffer) {
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

function fileNameForMime(mime: "image/jpeg" | "image/png" | "image/webp") {
  if (mime === "image/jpeg") return "image.jpg";
  if (mime === "image/webp") return "image.webp";
  return "image.png";
}
