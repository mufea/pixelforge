import sharp from "sharp";
import { normalizeProviderError } from "@/lib/ai/errors";
import type {
  EditInput,
  GenerateInput,
  ImageToImageInput,
  ProviderResult,
  RemoveBackgroundInput,
  RemoveObjectInput,
  UpscaleInput,
} from "@/lib/ai/types";
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

export async function mockEdit(input: EditInput, signal?: AbortSignal): Promise<ProviderResult> {
  throwIfAborted(signal);
  const prompt = input.prompt.trim();
  if (prompt.length < 3) {
    throw new DomainError("VALIDATION", "Prompt must be at least 3 characters");
  }

  const started = Date.now();
  const decoded = sharp(input.image, { failOn: "error" }).ensureAlpha();
  const { data, info } = await decoded.raw().toBuffer({ resolveWithObject: true });
  throwIfAborted(signal);

  const tone = prompt.charCodeAt(0) % 180;
  const border = Math.max(1, Math.min(3, Math.floor(Math.min(info.width, info.height) / 8)));
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const edge = x < border || y < border || x >= info.width - border || y >= info.height - border;
      if (!edge) {
        continue;
      }
      const i = (y * info.width + x) * 4;
      data[i] = Math.min(255, (data[i] ?? 0) + 40 + tone);
      data[i + 1] = Math.min(255, (data[i + 1] ?? 0) + 20);
      data[i + 2] = Math.min(255, 80 + tone);
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
    providerRequestId: `mock-edit-${Buffer.from(prompt).toString("hex").slice(0, 12)}`,
    latencyMs: Date.now() - started,
    rawModel: "mock-edit",
  };
}

export async function mockRemoveObject(input: RemoveObjectInput, signal?: AbortSignal): Promise<ProviderResult> {
  throwIfAborted(signal);
  const started = Date.now();
  const decoded = sharp(input.image, { failOn: "error" }).ensureAlpha();
  const { data, info } = await decoded.raw().toBuffer({ resolveWithObject: true });
  const mask = await sharp(input.mask, { failOn: "error" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  throwIfAborted(signal);

  if (mask.info.width !== info.width || mask.info.height !== info.height) {
    throw new DomainError("VALIDATION_MASK_SIZE", "The mask must match the source image dimensions");
  }

  let selected = false;
  for (let i = 0; i < data.length; i += 4) {
    const mr = mask.data[i] ?? 0;
    const mg = mask.data[i + 1] ?? 0;
    const mb = mask.data[i + 2] ?? 0;
    if (mr > 200 && mg > 200 && mb > 200) {
      selected = true;
      data[i] = 72;
      data[i + 1] = 72;
      data[i + 2] = 80;
      data[i + 3] = 255;
    }
  }
  if (!selected) {
    throw new DomainError("VALIDATION_MASK_EMPTY", "The mask must include white pixels marking the area to remove");
  }

  const bytes = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  throwIfAborted(signal);

  return {
    images: [{ bytes, mimeType: "image/png", width: info.width, height: info.height }],
    providerRequestId: `mock-object-remove-${info.width}x${info.height}`,
    latencyMs: Date.now() - started,
    rawModel: "mock-object-remove",
  };
}

export async function mockImageToImage(input: ImageToImageInput, signal?: AbortSignal): Promise<ProviderResult> {
  throwIfAborted(signal);
  const prompt = input.prompt.trim();
  if (prompt.length < 3) {
    throw new DomainError("VALIDATION", "Prompt must be at least 3 characters");
  }
  if (input.strength !== undefined && (!Number.isFinite(input.strength) || input.strength < 0.01 || input.strength > 1)) {
    throw new DomainError("VALIDATION", "strength must be between 0.01 and 1");
  }

  const started = Date.now();
  const metadata = await sharp(input.image, { failOn: "error" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 1 || height < 1) {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }

  const strength = input.strength ?? 0.95;
  const overlay = Math.round(40 + strength * 80);
  const bytes = await sharp(input.image, { failOn: "error" })
    .ensureAlpha()
    .modulate({ brightness: 1 + strength * 0.08 })
    .png()
    .toBuffer();
  throwIfAborted(signal);

  return {
    images: [{ bytes, mimeType: "image/png", width, height }],
    providerRequestId: `mock-i2i-${overlay}`,
    latencyMs: Date.now() - started,
    rawModel: "mock-image-to-image",
  };
}
