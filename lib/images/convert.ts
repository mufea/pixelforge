import { createHash } from "node:crypto";
import sharp from "sharp";
import { detectImageMime, type AllowedImageMime } from "@/lib/assets/mime";
import { DomainError } from "@/lib/errors";
import type { ImageLimits } from "@/lib/assets/validate-image";
import {
  assertCropBox,
  assertResizeWithinLimits,
  plannedOutputSize,
  type ImageTransform,
} from "@/lib/images/transform";

export const CONVERTIBLE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ConvertOptions = ImageTransform & {
  quality?: number;
};

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
  options: ConvertOptions = {},
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

  const quality = options.quality ?? 80;
  const pipeline = sharp(input, {
    limitInputPixels: limits.maxImagePixels,
    failOn: "error",
  }).rotate();

  let metadata: { width?: number; height?: number };
  try {
    metadata = await pipeline.clone().metadata();
  } catch (error) {
    if (isPixelLimitError(error)) {
      throw new DomainError("VALIDATION_IMAGE_TOO_LARGE", "The image dimensions exceed the allowed limits");
    }
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The image could not be decoded");
  }

  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The image could not be decoded");
  }
  if (sourceWidth > limits.maxImageEdgePx || sourceHeight > limits.maxImageEdgePx) {
    throw new DomainError("VALIDATION_IMAGE_TOO_LARGE", "The image edge exceeds the allowed maximum");
  }
  if (sourceWidth * sourceHeight > limits.maxImagePixels) {
    throw new DomainError("VALIDATION_IMAGE_TOO_LARGE", "The image pixel count exceeds the allowed maximum");
  }

  if (options.crop) {
    assertCropBox(options.crop, sourceWidth, sourceHeight);
    pipeline.extract(options.crop);
  }

  const planned = plannedOutputSize(sourceWidth, sourceHeight, options);
  assertResizeWithinLimits(planned.width, planned.height, limits);

  if (options.width || options.height) {
    pipeline.resize({
      width: options.width,
      height: options.height,
      fit: options.width && options.height ? "fill" : "inside",
      withoutEnlargement: false,
    });
  }

  if (outputMime === "image/jpeg") {
    pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
  }

  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    const encoded =
      outputMime === "image/png"
        ? pipeline.png({ compressionLevel: 8 })
        : outputMime === "image/webp"
          ? pipeline.webp({ quality })
          : pipeline.jpeg({ quality, mozjpeg: true });
    output = await encoded.toBuffer({ resolveWithObject: true });
  } catch {
    throw new DomainError("CONVERSION_FAILED", "The image could not be converted");
  }

  const outputDetected = detectImageMime(output.data);
  if (outputDetected !== outputMime) {
    throw new DomainError("CONVERSION_FAILED", "Conversion produced an unexpected file type");
  }

  return {
    bytes: output.data,
    mimeType: outputMime,
    width: output.info.width,
    height: output.info.height,
    checksumSha256: createHash("sha256").update(output.data).digest("hex"),
    inputByteSize: input.byteLength,
    outputByteSize: output.data.byteLength,
  };
}

function isPixelLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /pixel limit|input image exceeds/i.test(message);
}
