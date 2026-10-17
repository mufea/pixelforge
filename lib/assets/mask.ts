import sharp from "sharp";
import { detectImageMime } from "@/lib/assets/mime";
import { DomainError } from "@/lib/errors";

export async function assertCompatibleMask(
  mask: Buffer,
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ width: number; height: number }> {
  const mime = detectImageMime(mask);
  if (mime !== "image/png") {
    throw new DomainError("VALIDATION_INVALID_MIME", "Masks must be PNG images");
  }
  const metadata = await sharp(mask, { failOn: "error" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width !== sourceWidth || height !== sourceHeight) {
    throw new DomainError("VALIDATION_MASK_SIZE", "The mask must match the source image dimensions");
  }
  return { width, height };
}

export async function assertMaskHasSelection(mask: Buffer) {
  const { data, info } = await sharp(mask, { failOn: "error" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = info.channels === 4 ? (data[i + 3] ?? 255) : 255;
    if (a > 0 && r > 200 && g > 200 && b > 200) {
      return;
    }
  }
  throw new DomainError("VALIDATION_MASK_EMPTY", "The mask must include white pixels marking the area to remove");
}
