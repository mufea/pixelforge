import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getBackgroundRemovalAdapter, runRemoveBackground } from "@/lib/ai/factory";
import { falRemoveBackground, isAllowedFalResultUrl } from "@/lib/ai/providers/fal";
import { setFalSubscriberForTests } from "@/lib/ai/providers/fal-client";
import { mockRemoveBackground } from "@/lib/ai/providers/mock";
import { resetEnvCache } from "@/lib/env";

async function opaquePng() {
  return sharp({
    create: { width: 16, height: 12, channels: 3, background: { r: 40, g: 90, b: 160 } },
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

describe("background removal adapter", () => {
  afterEach(() => {
    setFalSubscriberForTests(null);
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("runs the mock provider to a transparent PNG of the same size", async () => {
    const source = await opaquePng();
    const result = await runRemoveBackground({ image: source, mimeType: "image/png" }, AbortSignal.timeout(5_000));
    expect(result.rawModel).toBe("mock-bg-remove");
    expect(result.images[0]?.mimeType).toBe("image/png");
    expect(result.images[0]?.width).toBe(16);
    expect(result.images[0]?.height).toBe(12);
    const meta = await sharp(result.images[0]!.bytes).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(getBackgroundRemovalAdapter().providerId).toBe("mock");
  });

  it("maps an aborted mock background removal to TIMEOUT", async () => {
    const source = await opaquePng();
    await expect(mockRemoveBackground({ image: source, mimeType: "image/png" }, AbortSignal.abort())).rejects.toMatchObject(
      { code: "TIMEOUT" },
    );
  });

  it("fails closed without a Fal key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER_MODE", "live");
    vi.stubEnv("FAL_KEY", "");
    vi.stubEnv("FAL_API_KEY", "");
    resetEnvCache();
    const source = await opaquePng();
    await expect(falRemoveBackground({ image: source, mimeType: "image/png" }, AbortSignal.timeout(1000))).rejects.toMatchObject(
      { code: "PROVIDER_NOT_CONFIGURED" },
    );
  });

  it("maps Fal 429 and 5xx without a live call", async () => {
    liveFalEnv();
    const source = await opaquePng();
    setFalSubscriberForTests(async () => {
      throw Object.assign(new Error("slow"), { status: 429 });
    });
    await expect(falRemoveBackground({ image: source, mimeType: "image/png" }, AbortSignal.timeout(1000))).rejects.toMatchObject(
      { code: "PROVIDER_RATE_LIMITED" },
    );

    setFalSubscriberForTests(async () => {
      throw Object.assign(new Error("down"), { status: 503 });
    });
    await expect(falRemoveBackground({ image: source, mimeType: "image/png" }, AbortSignal.timeout(1000))).rejects.toMatchObject(
      { code: "PROVIDER_UNAVAILABLE" },
    );
  });

  it("maps an aborted Fal fetch to TIMEOUT without a live call", async () => {
    liveFalEnv();
    const source = await opaquePng();
    setFalSubscriberForTests(async (_model, _input, signal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    await expect(falRemoveBackground({ image: source, mimeType: "image/png" }, AbortSignal.timeout(1))).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("rejects untrusted Fal result URLs", () => {
    expect(isAllowedFalResultUrl("https://v3.fal.media/files/abc.png")).toBe(true);
    expect(isAllowedFalResultUrl("https://evil.example/steal.png")).toBe(false);
    expect(isAllowedFalResultUrl("http://v3.fal.media/files/abc.png")).toBe(false);
  });

  it("does not fetch a rejected Fal result host", async () => {
    liveFalEnv();
    const source = await opaquePng();
    setFalSubscriberForTests(async () => ({
      data: { image: { url: "https://evil.example/x.png" } },
    }));
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(falRemoveBackground({ image: source, mimeType: "image/png" }, AbortSignal.timeout(1000))).rejects.toMatchObject(
      { code: "PROVIDER_REJECTED" },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
