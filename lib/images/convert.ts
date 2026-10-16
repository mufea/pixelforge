import { createHash } from "node:crypto";
import sharp from "sharp";
import { detectImageMime, type AllowedImageMime } from "@/lib/assets/mime";
import { DomainError } from "@/lib/errors";
import type { ImageLimits } from "@/lib/assets/validate-image";

export const CONVERTIBLE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ConvertResult = {
  bytes: Buffer;
  mimeType: AllowedImageMime;
  width: number;
  height: number;
  checksumSha256: string;
  inputByteSize: number;
  outputByteSize: number;
};

export async function convertImageBytes(
  input: Buffer,
  outputMime: AllowedImageMime,
  limits: ImageLimits,
  quality = 80,
): Promise<ConvertResult> {
  if (input.byteLength === 0) {
    throw new DomainError("VALIDATION_EMPTY_FILE", "The source file is empty");
  }
  if (input.byteLength > limits.maxUploadBytes) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The source file exceeds the size limit");
  }

  const detected = detectImageMime(input);
  if (!detected) {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }

  let metadata: { width?: number; height?: number; format?: string };
  try {
    metadata = await sharp(input, {
      limitInputPixels: limits.maxImagePixels,
      failOn: "error",
    }).metadata();
  } catch (error) {
    if (isPixelLimitError(error)) {
      throw new DomainError("VALIDATION_IMAGE_TOO_LARGE", "The image dimensions exceed the allowed limits");
    }
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The image could not be decoded");
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 1 || height < 1) {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The image could not be decoded");
  }
  if (width > limits.maxImageEdgePx || height > limits.maxImageEdgePx) {
    throw new DomainError("VALIDATION_IMAGE_TOO_LARGE", "The image edge exceeds the allowed maximum");
  }
  if (width * height > limits.maxImagePixels) {
    throw new DomainError("VALIDATION_IMAGE_TOO_LARGE", "The image pixel count exceeds the allowed maximum");
  }

  let pipeline = sharp(input, { limitInputPixels: limits.maxImagePixels, failOn: "error" }).rotate();
  if (outputMime === "image/jpeg") {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
  }

  let bytes: Buffer;
  try {
    bytes =
      outputMime === "image/png"
        ? await pipeline.png({ compressionLevel: 8 }).toBuffer()
        : outputMime === "image/webp"
          ? await pipeline.webp({ quality }).toBuffer()
          : await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  } catch {
    throw new DomainError("CONVERSION_FAILED", "The image could not be converted");
  }

  const outputDetected = detectImageMime(bytes);
  if (outputDetected !== outputMime) {
    throw new DomainError("CONVERSION_FAILED", "Conversion produced an unexpected file type");
  }

  return {
    bytes,
    mimeType: outputMime,
    width,
    height,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    inputByteSize: input.byteLength,
    outputByteSize: bytes.byteLength,
  };
}

function isPixelLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /pixel limit|input image exceeds/i.test(message);
}
