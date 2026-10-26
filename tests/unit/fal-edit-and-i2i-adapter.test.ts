import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { resolveProvider } from "@/lib/ai/factory";
import {
  falEdit,
  falImageToImage,
  FAL_EDIT_MODEL,
  FAL_IMAGE_TO_IMAGE_MODEL,
} from "@/lib/ai/providers/fal";
import { setFalSubscriberForTests } from "@/lib/ai/providers/fal-client";
import { mockImageToImage } from "@/lib/ai/providers/mock";
import { resetEnvCache } from "@/lib/env";

async function png(width = 16, height = 12) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 40, b: 80 } },
  })
    .png()
    .toBuffer();
}

function liveFal() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AI_PROVIDER_MODE", "live");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("STABILITY_API_KEY", "");
  vi.stubEnv("FAL_KEY", "fal_sk_test_not_real");
  vi.stubEnv("FAL_API_KEY", "");
  resetEnvCache();
}

describe("Fal edit and image-to-image adapters", () => {
  afterEach(() => {
    setFalSubscriberForTests(null);
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("runs mock image-to-image to a same-size PNG", async () => {
    const source = await png();
    const result = await mockImageToImage(
      { image: source, mimeType: "image/png", prompt: "make it a watercolor", strength: 0.5 },
      AbortSignal.timeout(5_000),
    );
    expect(result.rawModel).toBe("mock-image-to-image");
    expect(result.images[0]?.width).toBe(16);
    expect(result.images[0]?.height).toBe(12);
  });

  it("subscribes to flux-kontext/dev with prompt and image_url and rejects masks", async () => {
    liveFal();
    expect(resolveProvider("EDIT")).toEqual({ providerId: "fal", modelId: FAL_EDIT_MODEL });
    const source = await png();
    const output = await png();
    setFalSubscriberForTests(async (modelId, input) => {
      expect(modelId).toBe(FAL_EDIT_MODEL);
      expect(input.prompt).toBe("make the mug blue");
      expect(String(input.image_url).startsWith("data:image/png;base64,")).toBe(true);
      expect(input.mask_url).toBeUndefined();
      return {
        data: { images: [{ content: output.toString("base64"), width: 16, height: 12 }] },
        requestId: "fal_edit_1",
      };
    });
    const result = await falEdit(
      { image: source, mimeType: "image/png", prompt: "make the mug blue" },
      AbortSignal.timeout(1000),
    );
    expect(result.rawModel).toBe(FAL_EDIT_MODEL);
    expect(result.providerRequestId).toBe("fal_edit_1");

    const mask = await png();
    await expect(
      falEdit({ image: source, mimeType: "image/png", prompt: "make the mug blue", mask }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "MODEL_CAPABILITY_UNSUPPORTED" });
  });

  it("subscribes to flux/dev/image-to-image with documented prompt, image_url, and strength", async () => {
    liveFal();
    expect(resolveProvider("IMAGE_TO_IMAGE")).toEqual({
      providerId: "fal",
      modelId: FAL_IMAGE_TO_IMAGE_MODEL,
    });
    const source = await png();
    const output = await png();
    setFalSubscriberForTests(async (modelId, input) => {
      expect(modelId).toBe(FAL_IMAGE_TO_IMAGE_MODEL);
      expect(input.prompt).toBe("a watercolor mug");
      expect(input.strength).toBe(0.8);
      expect(String(input.image_url).startsWith("data:image/png;base64,")).toBe(true);
      return {
        data: { images: [{ content: output.toString("base64"), width: 16, height: 12 }] },
        requestId: "fal_i2i_1",
      };
    });
    const result = await falImageToImage(
      { image: source, mimeType: "image/png", prompt: "a watercolor mug", strength: 0.8 },
      AbortSignal.timeout(1000),
    );
    expect(result.rawModel).toBe(FAL_IMAGE_TO_IMAGE_MODEL);
    expect(result.providerRequestId).toBe("fal_i2i_1");
  });

  it("rejects invalid strength and untrusted result URLs", async () => {
    liveFal();
    const source = await png();
    await expect(
      falImageToImage(
        { image: source, mimeType: "image/png", prompt: "a watercolor mug", strength: 1.2 },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    setFalSubscriberForTests(async () => ({
      data: { images: [{ url: "https://evil.example/x.png" }] },
    }));
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      falEdit({ image: source, mimeType: "image/png", prompt: "make it blue" }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps Fal edit abort to TIMEOUT without a live call", async () => {
    liveFal();
    const source = await png();
    setFalSubscriberForTests(async (_model, _input, signal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    await expect(
      falEdit({ image: source, mimeType: "image/png", prompt: "make it blue" }, AbortSignal.timeout(1)),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});
