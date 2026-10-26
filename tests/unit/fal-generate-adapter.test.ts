import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { resolveProvider } from "@/lib/ai/factory";
import { falGenerate, FAL_GENERATE_MODEL } from "@/lib/ai/providers/fal";
import { setFalSubscriberForTests } from "@/lib/ai/providers/fal-client";
import { resetEnvCache } from "@/lib/env";

async function png(width = 32, height = 32) {
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

describe("Fal generate adapter", () => {
  afterEach(() => {
    setFalSubscriberForTests(null);
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("selects Fal schnell when OpenAI is missing and Fal is configured", () => {
    liveFal();
    expect(resolveProvider("GENERATE")).toEqual({
      providerId: "fal",
      modelId: FAL_GENERATE_MODEL,
    });
  });

  it("keeps flux-2-pro as an unimplemented catalog stub", () => {
    liveFal();
    try {
      resolveProvider("GENERATE", { providerId: "fal", modelId: "fal-ai/flux-2-pro" });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "MODEL_DISABLED" });
    }
  });

  it("subscribes to flux/schnell with the prompt and does not hit an untrusted result URL", async () => {
    liveFal();
    const output = await png();
    setFalSubscriberForTests(async (modelId, input) => {
      expect(modelId).toBe(FAL_GENERATE_MODEL);
      expect(input.prompt).toBe("a ceramic mug");
      return {
        data: { images: [{ content: output.toString("base64"), width: 32, height: 32 }] },
        requestId: "fal_gen_1",
      };
    });
    const result = await falGenerate({ prompt: "a ceramic mug" }, AbortSignal.timeout(1000));
    expect(result.rawModel).toBe(FAL_GENERATE_MODEL);
    expect(result.providerRequestId).toBe("fal_gen_1");
    expect(result.images[0]?.width).toBe(32);
  });

  it("maps Fal generate 429 and abort through the official client wrapper", async () => {
    liveFal();
    setFalSubscriberForTests(async () => {
      throw Object.assign(new Error("slow"), { status: 429 });
    });
    await expect(falGenerate({ prompt: "a mug" }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });

    setFalSubscriberForTests(async (_model, _input, signal) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    await expect(falGenerate({ prompt: "a mug" }, AbortSignal.timeout(1))).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
});
