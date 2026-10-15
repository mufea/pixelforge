import { createHash } from "node:crypto";
import sharp from "sharp";
import { detectImageMime, type AllowedImageMime } from "@/lib/assets/mime";
import { DomainError } from "@/lib/errors";

export type ImageLimits = {
  maxUploadBytes: number;
  maxImagePixels: number;
  maxImageEdgePx: number;
};

export type SanitizedImage = {
  bytes: Buffer;
  mimeType: AllowedImageMime;
  width: number;
  height: number;
  checksumSha256: string;
};

export async function validateAndSanitizeImage(
  input: Buffer,
  declaredMime: AllowedImageMime,
  limits: ImageLimits,
): Promise<SanitizedImage> {
  if (input.byteLength === 0) {
    throw new DomainError("VALIDATION_EMPTY_FILE", "The uploaded file is empty");
  }
  if (input.byteLength > limits.maxUploadBytes) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The uploaded file exceeds the size limit");
  }

  const detected = detectImageMime(input);
  if (!detected) {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The file is not a JPEG, PNG, or WebP image");
  }
  if (detected !== declaredMime) {
    throw new DomainError("VALIDATION_MIME_MISMATCH", "The file contents do not match the declared type");
  }

  let metadata: { width?: number; height?: number; format?: string };
  try {
    metadata = await sharp(input, {
      limitInputPixels: limits.maxImagePixels,
      failOn: "error",
    }).metadata();
  } catch {
    throw new DomainError("VALIDATION_IMAGE_TOO_LARGE", "The image dimensions exceed the allowed limits");
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
  if (metadata.format !== mimeToSharpFormat(declaredMime)) {
    throw new DomainError("VALIDATION_MIME_MISMATCH", "The file contents do not match the declared type");
  }

  const pipeline = sharp(input, { limitInputPixels: limits.maxImagePixels, failOn: "error" }).rotate();
  const bytes =
    declaredMime === "image/png"
      ? await pipeline.png().toBuffer()
      : declaredMime === "image/webp"
        ? await pipeline.webp().toBuffer()
        : await pipeline.jpeg({ mozjpeg: true }).toBuffer();

  return {
    bytes,
    mimeType: declaredMime,
    width,
    height,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function mimeToSharpFormat(mime: AllowedImageMime) {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/png") return "png";
  return "webp";
}
