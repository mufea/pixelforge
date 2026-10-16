import sharp from "sharp";
import { normalizeProviderError } from "@/lib/ai/errors";
import type { GenerateInput, ProviderResult, RemoveBackgroundInput, UpscaleInput } from "@/lib/ai/types";
import { DomainError } from "@/lib/errors";

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw normalizeProviderError(
      signal.reason ?? Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }),
    );
  }
}

export async function mockGenerate(input: GenerateInput, signal?: AbortSignal): Promise<ProviderResult> {
  throwIfAborted(signal);

  const started = Date.now();
  const bytes = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 30, g: 64, b: 175 },
    },
  })
    .png()
    .toBuffer();

  throwIfAborted(signal);

  return {
    images: [{ bytes, mimeType: "image/png", width: 32, height: 32 }],
    providerRequestId: `mock-${Buffer.from(input.prompt).toString("hex").slice(0, 12)}`,
    latencyMs: Date.now() - started,
    rawModel: "mock-png",
  };
}

export async function mockRemoveBackground(
  input: RemoveBackgroundInput,
  signal?: AbortSignal,
): Promise<ProviderResult> {
  throwIfAborted(signal);
  const started = Date.now();

  const decoded = sharp(input.image, { failOn: "error" }).ensureAlpha();
  const { data, info } = await decoded.raw().toBuffer({ resolveWithObject: true });
  throwIfAborted(signal);

  const border = Math.max(1, Math.min(2, Math.floor(Math.min(info.width, info.height) / 4)));
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const edge = x < border || y < border || x >= info.width - border || y >= info.height - border;
      if (edge) {
        data[(y * info.width + x) * 4 + 3] = 0;
      }
    }
  }

  const bytes = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  throwIfAborted(signal);

  return {
    images: [{ bytes, mimeType: "image/png", width: info.width, height: info.height }],
    providerRequestId: `mock-bg-${info.width}x${info.height}`,
    latencyMs: Date.now() - started,
    rawModel: "mock-bg-remove",
  };
}

export async function mockUpscale(input: UpscaleInput, signal?: AbortSignal): Promise<ProviderResult> {
  throwIfAborted(signal);
  if (input.scaleFactor !== 2 && input.scaleFactor !== 3 && input.scaleFactor !== 4) {
    throw new DomainError("UNSUPPORTED_UPSCALE_FACTOR", "Upscale factor must be 2, 3, or 4");
  }

  const started = Date.now();
  const metadata = await sharp(input.image, { failOn: "error" }).metadata();
  const width = (metadata.width ?? 0) * input.scaleFactor;
  const height = (metadata.height ?? 0) * input.scaleFactor;
  if (width < 1 || height < 1) {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }

  const bytes = await sharp(input.image, { failOn: "error" })
    .resize(width, height, { kernel: "nearest" })
    .png()
    .toBuffer();
  throwIfAborted(signal);

  return {
    images: [{ bytes, mimeType: "image/png", width, height }],
    providerRequestId: `mock-upscale-${input.scaleFactor}x`,
    latencyMs: Date.now() - started,
    rawModel: "mock-upscale",
  };
}
