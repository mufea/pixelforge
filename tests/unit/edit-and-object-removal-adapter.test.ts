import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getEditAdapter, getObjectRemovalAdapter, runEdit, runRemoveObject } from "@/lib/ai/factory";
import { falRemoveObject, FAL_OBJECT_REMOVAL_MODEL } from "@/lib/ai/providers/fal";
import { setFalSubscriberForTests } from "@/lib/ai/providers/fal-client";
import { mockEdit, mockRemoveObject } from "@/lib/ai/providers/mock";
import { openaiEdit, OPENAI_EDIT_MODEL } from "@/lib/ai/providers/openai-edit";
import { resetEnvCache } from "@/lib/env";

async function sourcePng(width = 16, height = 12) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

async function selectionMask(width = 16, height = 12) {
  const white = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: white, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

function liveOpenAI() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AI_PROVIDER_MODE", "live");
  vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
  vi.stubEnv("FAL_KEY", "");
  resetEnvCache();
}

function liveFal() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AI_PROVIDER_MODE", "live");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("FAL_KEY", "fal_sk_test_not_real");
  vi.stubEnv("FAL_API_KEY", "");
  resetEnvCache();
}

describe("edit and object-removal adapters", () => {
  afterEach(() => {
    setFalSubscriberForTests(null);
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("runs the mock editor to a same-size PNG", async () => {
    const source = await sourcePng();
    const result = await runEdit({ image: source, mimeType: "image/png", prompt: "make it warmer" }, AbortSignal.timeout(5_000));
    expect(result.rawModel).toBe("mock-edit");
    expect(result.images[0]?.width).toBe(16);
    expect(result.images[0]?.height).toBe(12);
    expect(result.images[0]?.mimeType).toBe("image/png");
    expect(getEditAdapter().providerId).toBe("mock");
  });

  it("runs mock object removal only inside the white mask", async () => {
    const source = await sourcePng();
    const mask = await selectionMask();
    const result = await runRemoveObject({ image: source, mimeType: "image/png", mask }, AbortSignal.timeout(5_000));
    expect(result.rawModel).toBe("mock-object-remove");
    expect(result.images[0]?.width).toBe(16);
    expect(result.images[0]?.height).toBe(12);
    expect(getObjectRemovalAdapter().providerId).toBe("mock");
  });

  it("rejects an empty mask and aborted mock calls", async () => {
    const source = await sourcePng();
    const empty = await sharp({
      create: { width: 16, height: 12, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await expect(mockRemoveObject({ image: source, mask: empty }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "VALIDATION_MASK_EMPTY",
    });
    await expect(mockEdit({ image: source, prompt: "warm light" }, AbortSignal.abort())).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("fails closed without OpenAI or Fal keys and does not fetch", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER_MODE", "live");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("FAL_KEY", "");
    vi.stubEnv("FAL_API_KEY", "");
    resetEnvCache();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const source = await sourcePng();
    const mask = await selectionMask();
    await expect(
      openaiEdit({ image: source, mimeType: "image/png", prompt: "make it blue" }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    await expect(
      falRemoveObject({ image: source, mimeType: "image/png", mask }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts multipart edits to OpenAI without a live call", async () => {
    liveOpenAI();
    const source = await sourcePng();
    const output = await sourcePng(16, 12);
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/images/edits");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("model")).toBe(OPENAI_EDIT_MODEL);
      expect(form.get("prompt")).toBe("make the mug blue");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-test-not-real" });
      return new Response(JSON.stringify({ data: [{ b64_json: output.toString("base64") }], id: "edit_1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await openaiEdit(
      { image: source, mimeType: "image/png", prompt: "make the mug blue" },
      AbortSignal.timeout(1000),
    );
    expect(result.rawModel).toBe(OPENAI_EDIT_MODEL);
    expect(result.images[0]?.width).toBe(16);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("posts image_url and mask_url to Fal object-removal without a live call", async () => {
    liveFal();
    const source = await sourcePng();
    const mask = await selectionMask();
    const output = await sourcePng();
    setFalSubscriberForTests(async (modelId, input) => {
      expect(modelId).toBe(FAL_OBJECT_REMOVAL_MODEL);
      expect(String(input.image_url).startsWith("data:image/png;base64,")).toBe(true);
      expect(String(input.mask_url).startsWith("data:image/png;base64,")).toBe(true);
      return {
        data: { images: [{ url: "https://v3.fal.media/files/out.png", content: output.toString("base64") }] },
        requestId: "obj_1",
      };
    });
    const result = await falRemoveObject({ image: source, mimeType: "image/png", mask }, AbortSignal.timeout(1000));
    expect(result.rawModel).toBe(FAL_OBJECT_REMOVAL_MODEL);
    expect(result.providerRequestId).toBe("obj_1");
  });

  it("maps OpenAI and Fal 429/timeouts without live calls", async () => {
    liveOpenAI();
    const source = await sourcePng();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    await expect(
      openaiEdit({ image: source, mimeType: "image/png", prompt: "make it blue" }, AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });

    liveFal();
    const mask = await selectionMask();
    setFalSubscriberForTests(async (_model, _input, signal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    await expect(
      falRemoveObject({ image: source, mimeType: "image/png", mask }, AbortSignal.timeout(1)),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("does not fetch an untrusted Fal object-removal result host", async () => {
    liveFal();
    const source = await sourcePng();
    const mask = await selectionMask();
    setFalSubscriberForTests(async () => ({
      data: { images: [{ url: "https://evil.example/x.png" }] },
    }));
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(falRemoveObject({ image: source, mimeType: "image/png", mask }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
