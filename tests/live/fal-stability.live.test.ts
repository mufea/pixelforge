import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { falEdit, falGenerate, falImageToImage } from "@/lib/ai/providers/fal";
import {
  stabilityEdit,
  stabilityGenerate,
  stabilityRemoveBackground,
  stabilityRemoveObject,
  stabilityUpscale,
} from "@/lib/ai/providers/stability";
import { resetEnvCache } from "@/lib/env";

/**
 * Opt-in live provider smokes. Never run from `pnpm test`.
 *
 * Required:
 *   PIXELFORGE_LIVE_PROVIDERS=1
 *   FAL_KEY and/or STABILITY_API_KEY (server-side secrets only)
 *
 * Estimated costs (official published list prices, not a bill):
 *   fal-ai/flux/schnell                ~$0.003 / image
 *   fal-ai/flux-kontext/dev            check fal.ai pricing (~$0.025/image class)
 *   fal-ai/flux/dev/image-to-image     $0.025 / megapixel
 *   Stability generate/inpaint/erase/remove-background/upscale-fast  billed per Stability credits
 *
 * Prerequisites: a Fal account with billing enabled; a Stability account with API credits.
 * This file does not log secrets, signed URLs, or result hosts.
 */

const LIVE = process.env.PIXELFORGE_LIVE_PROVIDERS === "1";
const FAL = Boolean(process.env.FAL_KEY || process.env.FAL_API_KEY);
const STABILITY = Boolean(process.env.STABILITY_API_KEY);
const TIMEOUT_MS = 60_000;

async function tinyPng() {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();
}

async function tinyMask() {
  const white = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: white, left: 24, top: 24 }])
    .png()
    .toBuffer();
}

function assertImage(result: { images: Array<{ bytes: Buffer; width: number; height: number }> }, label: string) {
  const image = result.images[0];
  expect(image, `${label} returned no image`).toBeTruthy();
  expect(image!.bytes.byteLength).toBeGreaterThan(32);
  expect(image!.width).toBeGreaterThan(0);
  expect(image!.height).toBeGreaterThan(0);
  const magic = image!.bytes.subarray(0, 4);
  const png = magic.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpeg = magic[0] === 0xff && magic[1] === 0xd8;
  const webp = image!.bytes.subarray(0, 4).toString("ascii") === "RIFF";
  expect(png || jpeg || webp).toBe(true);
}

describe.skipIf(!LIVE)("live Fal smokes", { timeout: TIMEOUT_MS }, () => {
  afterEach(() => {
    resetEnvCache();
  });

  it.skipIf(!FAL)("generates with fal-ai/flux/schnell", async () => {
    const result = await falGenerate({ prompt: "a tiny red square on white" }, AbortSignal.timeout(TIMEOUT_MS));
    assertImage(result, "fal generate");
  });

  it.skipIf(!FAL)("edits with fal-ai/flux-kontext/dev", async () => {
    const source = await tinyPng();
    const result = await falEdit(
      { image: source, mimeType: "image/png", prompt: "make the square blue" },
      AbortSignal.timeout(TIMEOUT_MS),
    );
    assertImage(result, "fal edit");
  });

  it.skipIf(!FAL)("runs fal-ai/flux/dev/image-to-image", async () => {
    const source = await tinyPng();
    const result = await falImageToImage(
      { image: source, mimeType: "image/png", prompt: "a ceramic mug, studio light", strength: 0.6 },
      AbortSignal.timeout(TIMEOUT_MS),
    );
    assertImage(result, "fal image-to-image");
  });
});

describe.skipIf(!LIVE)("live Stability smokes", { timeout: TIMEOUT_MS }, () => {
  afterEach(() => {
    resetEnvCache();
  });

  it.skipIf(!STABILITY)("generates with Stable Image Ultra", async () => {
    const result = await stabilityGenerate({ prompt: "a tiny red square on white" }, AbortSignal.timeout(TIMEOUT_MS));
    assertImage(result, "stability generate");
  });

  it.skipIf(!STABILITY)("inpaints, erases, removes background, and upscales 4x", async () => {
    const source = await tinyPng();
    const mask = await tinyMask();
    const edited = await stabilityEdit(
      { image: source, mimeType: "image/png", prompt: "make it blue", mask },
      AbortSignal.timeout(TIMEOUT_MS),
    );
    assertImage(edited, "stability inpaint");
    const erased = await stabilityRemoveObject(
      { image: source, mimeType: "image/png", mask },
      AbortSignal.timeout(TIMEOUT_MS),
    );
    assertImage(erased, "stability erase");
    const cutout = await stabilityRemoveBackground({ image: source, mimeType: "image/png" }, AbortSignal.timeout(TIMEOUT_MS));
    assertImage(cutout, "stability remove-background");
    const upscaled = await stabilityUpscale(
      { image: source, mimeType: "image/png", scaleFactor: 4 },
      AbortSignal.timeout(TIMEOUT_MS),
    );
    assertImage(upscaled, "stability upscale");
    expect(upscaled.images[0]!.width).toBeGreaterThanOrEqual(64 * 2);
  });
});
