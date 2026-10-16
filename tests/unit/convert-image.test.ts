import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectImageMime } from "@/lib/assets/mime";
import { convertImageBytes } from "@/lib/images/convert";

const limits = { maxUploadBytes: 1_000_000, maxImagePixels: 10_000, maxImageEdgePx: 64 };

async function png(width = 12, height = 8) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

describe("convertImageBytes", () => {
  it("converts PNG to JPEG and WebP", async () => {
    const input = await png();
    const jpeg = await convertImageBytes(input, "image/jpeg", limits);
    expect(detectImageMime(jpeg.bytes)).toBe("image/jpeg");
    expect(jpeg.inputByteSize).toBe(input.byteLength);
    expect(jpeg.outputByteSize).toBe(jpeg.bytes.byteLength);
    expect(jpeg.width).toBe(12);

    const webp = await convertImageBytes(input, "image/webp", limits);
    expect(detectImageMime(webp.bytes)).toBe("image/webp");
  });

  it("converts JPEG to PNG", async () => {
    const jpeg = await sharp({
      create: { width: 10, height: 8, channels: 3, background: { r: 8, g: 40, b: 90 } },
    })
      .jpeg()
      .toBuffer();
    const pngOut = await convertImageBytes(jpeg, "image/png", limits);
    expect(detectImageMime(pngOut.bytes)).toBe("image/png");
  });

  it("rejects malformed bytes", async () => {
    await expect(convertImageBytes(Buffer.from("not-an-image"), "image/png", limits)).rejects.toMatchObject({
      code: "VALIDATION_INVALID_SIGNATURE",
    });
  });

  it("rejects oversized edges", async () => {
    const input = await png(80, 8);
    await expect(convertImageBytes(input, "image/jpeg", limits)).rejects.toMatchObject({
      code: "VALIDATION_IMAGE_TOO_LARGE",
    });
  });

  it("rejects oversized files before decoding", async () => {
    await expect(convertImageBytes(Buffer.alloc(1_000_001), "image/png", limits)).rejects.toMatchObject({
      code: "VALIDATION_FILE_TOO_LARGE",
    });
  });

  it("rejects truncated PNGs that still have a valid signature", async () => {
    const input = await png();
    const truncated = input.subarray(0, 16);
    expect(detectImageMime(truncated)).toBe("image/png");
    await expect(convertImageBytes(truncated, "image/png", limits)).rejects.toMatchObject({
      code: "VALIDATION_INVALID_SIGNATURE",
    });
  });
});
