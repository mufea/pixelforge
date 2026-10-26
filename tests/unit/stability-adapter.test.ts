import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { resolveProvider } from "@/lib/ai/factory";
import {
  STABILITY_EDIT_MODEL,
  STABILITY_GENERATE_MODEL,
  STABILITY_OBJECT_REMOVAL_MODEL,
  STABILITY_REMOVE_BACKGROUND_MODEL,
  STABILITY_UPSCALE_MODEL,
  stabilityEdit,
  stabilityGenerate,
  stabilityRemoveBackground,
  stabilityRemoveObject,
  stabilityUpscale,
} from "@/lib/ai/providers/stability";
import { resetEnvCache } from "@/lib/env";

async function sourcePng(width = 16, height = 12) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

function liveStability() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AI_PROVIDER_MODE", "live");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("FAL_KEY", "");
  vi.stubEnv("FAL_API_KEY", "");
  vi.stubEnv("STABILITY_API_KEY", "sk-stability-test-not-real");
  resetEnvCache();
}

describe("Stability AI adapter", () => {
  afterEach(() => {
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails closed without STABILITY_API_KEY and does not fetch", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER_MODE", "live");
    vi.stubEnv("STABILITY_API_KEY", "");
    resetEnvCache();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(stabilityGenerate({ prompt: "a mug" }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("selects Stability when it is the only configured generate provider", () => {
    liveStability();
    expect(resolveProvider("GENERATE")).toEqual({
      providerId: "stability",
      modelId: STABILITY_GENERATE_MODEL,
    });
    expect(resolveProvider("EDIT")).toEqual({
      providerId: "stability",
      modelId: STABILITY_EDIT_MODEL,
    });
    expect(resolveProvider("REMOVE_BACKGROUND")).toEqual({
      providerId: "stability",
      modelId: STABILITY_REMOVE_BACKGROUND_MODEL,
    });
    expect(resolveProvider("REMOVE_OBJECT")).toEqual({
      providerId: "stability",
      modelId: STABILITY_OBJECT_REMOVAL_MODEL,
    });
    expect(resolveProvider("UPSCALE")).toEqual({
      providerId: "stability",
      modelId: STABILITY_UPSCALE_MODEL,
    });
  });

  it("posts multipart generate to Stable Image Ultra without a live call", async () => {
    liveStability();
    const output = await sourcePng(32, 32);
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.stability.ai/v2beta/stable-image/generate/ultra");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("prompt")).toBe("a ceramic mug");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer sk-stability-test-not-real",
        Accept: "application/json",
      });
      return new Response(JSON.stringify({ image: output.toString("base64"), finish_reason: "SUCCESS" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "x-request-id": "stab_gen_1" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await stabilityGenerate({ prompt: "a ceramic mug" }, AbortSignal.timeout(1000));
    expect(result.rawModel).toBe(STABILITY_GENERATE_MODEL);
    expect(result.providerRequestId).toBe("stab_gen_1");
    expect(result.images[0]?.width).toBe(32);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("maps Stability 429, 5xx, safety, and abort without a live call", async () => {
    liveStability();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    await expect(stabilityGenerate({ prompt: "a mug" }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(stabilityGenerate({ prompt: "a mug" }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name: "content_moderation", errors: ["safety filter"] }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(stabilityGenerate({ prompt: "a mug" }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "SAFETY_REJECTED",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }),
    );
    await expect(stabilityGenerate({ prompt: "a mug" }, AbortSignal.timeout(1))).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("rejects Stability upscale factors other than 4 before fetch", async () => {
    liveStability();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const source = await sourcePng();
    await expect(
      stabilityUpscale({ image: source, mimeType: "image/png", scaleFactor: 2 }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_UPSCALE_FACTOR" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts inpaint, erase, remove-background, and 4× upscale without a live call", async () => {
    liveStability();
    const source = await sourcePng();
    const mask = await sourcePng();
    const output = await sourcePng(64, 48);
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ image: output.toString("base64"), finish_reason: "SUCCESS" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await stabilityEdit({ image: source, mimeType: "image/png", prompt: "make it blue", mask }, AbortSignal.timeout(1000));
    await stabilityRemoveObject({ image: source, mimeType: "image/png", mask }, AbortSignal.timeout(1000));
    await stabilityRemoveBackground({ image: source, mimeType: "image/png" }, AbortSignal.timeout(1000));
    const upscaled = await stabilityUpscale(
      { image: source, mimeType: "image/png", scaleFactor: 4 },
      AbortSignal.timeout(1000),
    );
    expect(upscaled.rawModel).toBe(STABILITY_UPSCALE_MODEL);
    expect(seen).toEqual([
      "https://api.stability.ai/v2beta/stable-image/edit/inpaint",
      "https://api.stability.ai/v2beta/stable-image/edit/erase",
      "https://api.stability.ai/v2beta/stable-image/edit/remove-background",
      "https://api.stability.ai/v2beta/stable-image/upscale/fast",
    ]);
  });

  it("does not fall back from Fal to Stability after an explicit Fal selection", () => {
    liveStability();
    vi.stubEnv("FAL_KEY", "fal_sk_test_not_real");
    resetEnvCache();
    expect(resolveProvider("REMOVE_BACKGROUND")).toEqual({
      providerId: "fal",
      modelId: "fal-ai/bria/background/remove",
    });
    expect(resolveProvider("REMOVE_BACKGROUND", { providerId: "stability" })).toEqual({
      providerId: "stability",
      modelId: STABILITY_REMOVE_BACKGROUND_MODEL,
    });
  });
});
