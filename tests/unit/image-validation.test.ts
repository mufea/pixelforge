import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectImageMime } from "@/lib/assets/mime";
import { validateAndSanitizeImage } from "@/lib/assets/validate-image";
import { DomainError } from "@/lib/errors";

const limits = { maxUploadBytes: 1_000_000, maxImagePixels: 10_000, maxImageEdgePx: 64 };

async function png(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 34, g: 68, b: 170 } },
  })
    .png()
    .toBuffer();
}

describe("image validation", () => {
  it("accepts a small PNG and strips metadata", async () => {
    const input = await png(8, 8);
    const result = await validateAndSanitizeImage(input, "image/png", limits);
    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    const meta = await sharp(result.bytes).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("rejects files whose magic bytes are not an allowed image", async () => {
    expect(detectImageMime(Buffer.from("not-an-image"))).toBeNull();
    await expect(validateAndSanitizeImage(Buffer.from("not-an-image"), "image/png", limits)).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it("rejects a JPEG declared as PNG", async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    await expect(validateAndSanitizeImage(jpeg, "image/png", limits)).rejects.toMatchObject({
      code: "VALIDATION_MIME_MISMATCH",
    });
  });

  it("rejects oversized edges", async () => {
    const input = await png(80, 8);
    await expect(validateAndSanitizeImage(input, "image/png", limits)).rejects.toMatchObject({
      code: "VALIDATION_IMAGE_TOO_LARGE",
    });
  });

  it("rejects oversized pixel counts", async () => {
    const input = await png(64, 64);
    await expect(
      validateAndSanitizeImage(input, "image/png", { ...limits, maxImagePixels: 100 }),
    ).rejects.toMatchObject({
      code: "VALIDATION_IMAGE_TOO_LARGE",
    });
  });
});
