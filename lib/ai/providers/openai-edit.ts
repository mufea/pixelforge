import "server-only";

import sharp from "sharp";
import { getOpenAICredentials } from "@/lib/ai/config";
import { domainErrorFromProviderResponse, normalizeProviderError } from "@/lib/ai/errors";
import type { EditInput, ProviderResult } from "@/lib/ai/types";
import { detectImageMime } from "@/lib/assets/mime";
import { DomainError } from "@/lib/errors";

export const OPENAI_EDIT_MODEL = "gpt-image-2.5-flare";

export async function openaiEdit(input: EditInput, signal: AbortSignal): Promise<ProviderResult> {
  const credentials = getOpenAICredentials();
  const prompt = input.prompt.trim();
  if (prompt.length < 3) {
    throw new DomainError("VALIDATION", "Prompt must be at least 3 characters");
  }

  const mime = input.mimeType ?? detectImageMime(input.image);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }

  const started = Date.now();
  const form = new FormData();
  form.set("model", OPENAI_EDIT_MODEL);
  form.set("prompt", prompt);
  form.set("n", "1");
  form.set("image", new File([Uint8Array.from(input.image)], filenameForMime(mime), { type: mime }));
  if (input.mask) {
    const maskMime = detectImageMime(input.mask);
    if (maskMime !== "image/png") {
      throw new DomainError("VALIDATION_INVALID_MIME", "Edit masks must be PNG images");
    }
    form.set("mask", new File([Uint8Array.from(input.mask)], "mask.png", { type: "image/png" }));
  }

  let response: Response;
  try {
    response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}/images/edits`, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${credentials.apiKey}` },
      body: form,
    });
  } catch (error) {
    throw normalizeProviderError(error);
  }

  if (!response.ok) {
    throw await domainErrorFromProviderResponse(response);
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    id?: string;
  };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not return image bytes", 502);
  }

  const bytes = Buffer.from(b64, "base64");
  const inspected = await inspectEditedImage(bytes);
  return {
    images: [{ bytes, mimeType: inspected.mimeType, width: inspected.width, height: inspected.height }],
    providerRequestId: payload.id,
    latencyMs: Date.now() - started,
    rawModel: OPENAI_EDIT_MODEL,
  };
}

async function inspectEditedImage(bytes: Buffer) {
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

function filenameForMime(mime: "image/jpeg" | "image/png" | "image/webp") {
  if (mime === "image/jpeg") return "source.jpg";
  if (mime === "image/webp") return "source.webp";
  return "source.png";
}
