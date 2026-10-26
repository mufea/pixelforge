import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getUpscaleAdapter, resolveProvider, runUpscale } from "@/lib/ai/factory";
import { falUpscale, FAL_UPSCALE_MODEL, isAllowedFalResultUrl } from "@/lib/ai/providers/fal";
import { setFalSubscriberForTests } from "@/lib/ai/providers/fal-client";
import { mockUpscale } from "@/lib/ai/providers/mock";
import { resetEnvCache } from "@/lib/env";

async function sourcePng(width = 16, height = 12) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

function liveFalEnv() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AI_PROVIDER_MODE", "live");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("FAL_KEY", "fal_sk_test_not_real");
  vi.stubEnv("FAL_API_KEY", "");
  resetEnvCache();
}

describe("upscale adapter", () => {
  afterEach(() => {
    setFalSubscriberForTests(null);
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("runs the mock provider to a nearest-neighbor PNG at 2×, 3×, and 4×", async () => {
    const source = await sourcePng();
    for (const scaleFactor of [2, 3, 4] as const) {
      const result = await runUpscale(
        { image: source, mimeType: "image/png", scaleFactor },
        AbortSignal.timeout(5_000),
      );
      expect(result.rawModel).toBe("mock-upscale");
      expect(result.images[0]?.mimeType).toBe("image/png");
      expect(result.images[0]?.width).toBe(16 * scaleFactor);
      expect(result.images[0]?.height).toBe(12 * scaleFactor);
      expect(result.images[0]?.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
    expect(getUpscaleAdapter().providerId).toBe("mock");
    expect(resolveProvider("UPSCALE")).toEqual({ providerId: "mock", modelId: "mock-upscale" });
  });

  it("rejects unsupported scale factors on the mock adapter", async () => {
    const source = await sourcePng();
    await expect(
      mockUpscale({ image: source, mimeType: "image/png", scaleFactor: 5 as never }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_UPSCALE_FACTOR" });
    await expect(
      mockUpscale({ image: source, mimeType: "image/png", scaleFactor: 1 as never }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_UPSCALE_FACTOR" });
  });

  it("maps an aborted mock upscale to TIMEOUT", async () => {
    const source = await sourcePng();
    await expect(
      mockUpscale({ image: source, mimeType: "image/png", scaleFactor: 2 }, AbortSignal.abort()),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("fails closed without a Fal key and does not fetch", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER_MODE", "live");
    vi.stubEnv("FAL_KEY", "");
    vi.stubEnv("FAL_API_KEY", "");
    resetEnvCache();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const source = await sourcePng();
    await expect(
      falUpscale({ image: source, mimeType: "image/png", scaleFactor: 2 }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts image_url and upscale_factor to the Flux Vision upscaler without a live call", async () => {
    liveFalEnv();
    const source = await sourcePng();
    const output = await sourcePng(32, 24);
    setFalSubscriberForTests(async (modelId, input) => {
      expect(modelId).toBe(FAL_UPSCALE_MODEL);
      expect(input.upscale_factor).toBe(2);
      expect(String(input.image_url).startsWith("data:image/png;base64,")).toBe(true);
      return {
        data: { image: { content: output.toString("base64"), width: 32, height: 24 } },
        requestId: "fal_upscale_req",
      };
    });

    const result = await falUpscale({ image: source, mimeType: "image/png", scaleFactor: 2 }, AbortSignal.timeout(1000));
    expect(result.rawModel).toBe(FAL_UPSCALE_MODEL);
    expect(result.providerRequestId).toBe("fal_upscale_req");
    expect(result.images[0]?.width).toBe(32);
    expect(result.images[0]?.height).toBe(24);
  });

  it("maps Fal 429, 5xx, and malformed payloads without a live call", async () => {
    liveFalEnv();
    const source = await sourcePng();
    setFalSubscriberForTests(async () => {
      throw Object.assign(new Error("slow"), { status: 429 });
    });
    await expect(
      falUpscale({ image: source, mimeType: "image/png", scaleFactor: 2 }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });

    setFalSubscriberForTests(async () => {
      throw Object.assign(new Error("down"), { status: 503 });
    });
    await expect(
      falUpscale({ image: source, mimeType: "image/png", scaleFactor: 2 }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    setFalSubscriberForTests(async () => ({ data: { image: {} } }));
    await expect(
      falUpscale({ image: source, mimeType: "image/png", scaleFactor: 2 }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
  });

  it("maps an aborted Fal fetch to TIMEOUT without a live call", async () => {
    liveFalEnv();
    const source = await sourcePng();
    setFalSubscriberForTests(async (_model, _input, signal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    await expect(
      falUpscale({ image: source, mimeType: "image/png", scaleFactor: 2 }, AbortSignal.timeout(1)),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects untrusted Fal result URLs and does not fetch them", async () => {
    expect(isAllowedFalResultUrl("https://v3.fal.media/files/upscale.png")).toBe(true);
    expect(isAllowedFalResultUrl("https://evil.example/steal.png")).toBe(false);

    liveFalEnv();
    const source = await sourcePng();
    setFalSubscriberForTests(async () => ({
      data: { image: { url: "https://evil.example/x.png" } },
    }));
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      falUpscale({ image: source, mimeType: "image/png", scaleFactor: 2 }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects unsupported scale factors before calling Fal", async () => {
    liveFalEnv();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const source = await sourcePng();
    await expect(
      falUpscale({ image: source, mimeType: "image/png", scaleFactor: 8 as never }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_UPSCALE_FACTOR" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
