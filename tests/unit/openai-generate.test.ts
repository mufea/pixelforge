import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiGenerate } from "@/lib/ai/providers/openai-generate";
import { resolveGenerateProvider } from "@/lib/ai/generate";
import { loadEnv, resetEnvCache } from "@/lib/env";

const required = {
  APP_URL: "http://127.0.0.1:43127",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-12",
  DATABASE_URL: "postgresql://pixelforge:pixelforge@127.0.0.1:5432/pixelforge",
};

describe("openai generate adapter", () => {
  afterEach(() => {
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails clearly when the API key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    resetEnvCache();
    await expect(openaiGenerate({ prompt: "a mug" }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("maps provider 429 to PROVIDER_RATE_LIMITED", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
    resetEnvCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("slow down", { status: 429 })),
    );
    await expect(openaiGenerate({ prompt: "a mug" }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
  });

  it("maps provider 5xx to PROVIDER_UNAVAILABLE", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
    resetEnvCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    await expect(openaiGenerate({ prompt: "a mug" }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("does not use mock generation in live development without a key", () => {
    const env = loadEnv({
      ...required,
      NODE_ENV: "development",
      AI_PROVIDER_MODE: "live",
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER_MODE", "live");
    vi.stubEnv("OPENAI_API_KEY", "");
    resetEnvCache();
    expect(() => resolveGenerateProvider()).toThrow(/No image generation provider is configured/);
  });
});
