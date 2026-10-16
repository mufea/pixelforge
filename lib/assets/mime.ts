export const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

const EXTENSIONS: Record<AllowedImageMime, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

export function isAllowedImageMime(value: string): value is AllowedImageMime {
  return (ALLOWED_IMAGE_MIMES as readonly string[]).includes(value);
}

export function extensionMatchesMime(filename: string, mime: AllowedImageMime) {
  const lower = filename.toLowerCase();
  return EXTENSIONS[mime].some((ext) => lower.endsWith(ext));
}

export function displayFilename(input: string) {
  const base = input.replaceAll("\\", "/").split("/").pop()?.trim() || "upload";
  return base.slice(0, 180);
}

export function extensionForMime(mime: AllowedImageMime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".png";
}

export function filenameForMime(originalFilename: string, mime: AllowedImageMime) {
  const base = displayFilename(originalFilename).replace(/\.(jpe?g|png|webp)$/i, "");
  return `${base}${extensionForMime(mime)}`.slice(0, 180);
}

export function detectImageMime(bytes: Buffer): AllowedImageMime | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
