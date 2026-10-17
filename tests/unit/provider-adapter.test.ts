import { afterEach, describe, expect, it, vi } from "vitest";
import { getFalCredentials, getProviderRuntimeConfig, publicProviderStatuses } from "@/lib/ai/config";
import {
  domainErrorFromProviderResponse,
  isRetryableProviderCode,
  isRetryableProviderError,
  normalizeProviderError,
} from "@/lib/ai/errors";
import { getGenerationAdapter, resolveGenerateProvider, resolveProvider, runGenerate } from "@/lib/ai/factory";
import { falUnimplemented } from "@/lib/ai/providers/fal";
import { googleUnimplemented } from "@/lib/ai/providers/google";
import { mockGenerate } from "@/lib/ai/providers/mock";
import { openaiGenerate } from "@/lib/ai/providers/openai-generate";
import { MODEL_CATALOG } from "@/lib/ai/registry";
import { IMAGE_OPERATIONS } from "@/lib/ai/types";
import { DomainError } from "@/lib/errors";
import { loadEnv, resetEnvCache } from "@/lib/env";

const required = {
  APP_URL: "http://127.0.0.1:43127",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-12",
  DATABASE_URL: "postgresql://pixelforge:pixelforge@127.0.0.1:5432/pixelforge",
};

function liveEnv(overrides: Record<string, string> = {}) {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AI_PROVIDER_MODE", "live");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("FAL_KEY", "");
  vi.stubEnv("FAL_API_KEY", "");
  vi.stubEnv("GOOGLE_AI_API_KEY", "");
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  resetEnvCache();
}

describe("provider adapter architecture", () => {
  afterEach(() => {
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("provider selection", () => {
    it("auto-selects mock when mock mode is allowed", () => {
      expect(resolveGenerateProvider()).toBe("mock");
      expect(resolveProvider("GENERATE")).toEqual({ providerId: "mock", modelId: "mock-png" });
      expect(getGenerationAdapter().providerId).toBe("mock");
      expect(resolveProvider("REMOVE_BACKGROUND")).toEqual({
        providerId: "mock",
        modelId: "mock-bg-remove",
      });
      expect(resolveProvider("UPSCALE")).toEqual({
        providerId: "mock",
        modelId: "mock-upscale",
      });
      expect(resolveProvider("EDIT")).toEqual({
        providerId: "mock",
        modelId: "mock-edit",
      });
      expect(resolveProvider("REMOVE_OBJECT")).toEqual({
        providerId: "mock",
        modelId: "mock-object-remove",
      });
    });

    it("selects OpenAI when requested explicitly and configured", () => {
      liveEnv({ OPENAI_API_KEY: "sk-test-not-real" });
      expect(resolveGenerateProvider("openai")).toBe("openai");
      expect(resolveProvider("GENERATE", { providerId: "openai" })).toEqual({
        providerId: "openai",
        modelId: "gpt-image-2.5-flare",
      });
    });

    it("keeps auto-select on mock in test even when OpenAI is configured", () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
      resetEnvCache();
      expect(resolveGenerateProvider()).toBe("mock");
    });

    it("rejects unknown provider ids", () => {
      expect(() => resolveProvider("GENERATE", { providerId: "nope" })).toThrow(DomainError);
      try {
        resolveProvider("GENERATE", { providerId: "nope" });
      } catch (error) {
        expect(error).toMatchObject({ code: "VALIDATION" });
      }
    });

    it("does not register Sharp convert as an AI operation", () => {
      expect((IMAGE_OPERATIONS as readonly string[]).includes("CONVERT")).toBe(false);
      expect(MODEL_CATALOG.map((model) => model.providerId)).toEqual(
        expect.arrayContaining(["mock", "openai", "fal", "google"]),
      );
    });
  });

  describe("missing configuration", () => {
    it("fails closed in live mode when no generate provider is configured", () => {
      liveEnv();
      expect(() => resolveGenerateProvider()).toThrow(/No image generation provider is configured/);
      try {
        resolveGenerateProvider();
      } catch (error) {
        expect(error).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED", status: 503 });
      }
    });

    it("rejects explicit OpenAI selection without a key", () => {
      liveEnv();
      expect(() => resolveGenerateProvider("openai")).toThrow(DomainError);
      try {
        resolveGenerateProvider("openai");
      } catch (error) {
        expect(error).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
      }
    });

    it("fails closed in live mode when no background-removal provider is configured", () => {
      liveEnv();
      try {
        resolveProvider("REMOVE_BACKGROUND");
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED", status: 503 });
      }
    });

    it("selects Fal for background removal when configured", () => {
      liveEnv({ FAL_KEY: "fal_sk_test_not_real" });
      expect(resolveProvider("REMOVE_BACKGROUND")).toEqual({
        providerId: "fal",
        modelId: "fal-ai/bria/background/remove",
      });
    });

    it("fails closed in live mode when no upscale provider is configured", () => {
      liveEnv();
      try {
        resolveProvider("UPSCALE");
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED", status: 503 });
      }
    });

    it("selects Fal for upscale when configured", () => {
      liveEnv({ FAL_KEY: "fal_sk_test_not_real" });
      expect(resolveProvider("UPSCALE")).toEqual({
        providerId: "fal",
        modelId: "fal-ai/flux-vision-upscaler",
      });
    });

    it("fails closed in live mode when no edit provider is configured", () => {
      liveEnv();
      try {
        resolveProvider("EDIT");
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED", status: 503 });
      }
    });

    it("selects OpenAI for edit when configured", () => {
      liveEnv({ OPENAI_API_KEY: "sk-test-not-real" });
      expect(resolveProvider("EDIT")).toEqual({
        providerId: "openai",
        modelId: "gpt-image-2.5-flare",
      });
    });

    it("fails closed in live mode when no object-removal provider is configured", () => {
      liveEnv();
      try {
        resolveProvider("REMOVE_OBJECT");
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED", status: 503 });
      }
    });

    it("selects Fal for object removal when configured", () => {
      liveEnv({ FAL_KEY: "fal_sk_test_not_real" });
      expect(resolveProvider("REMOVE_OBJECT")).toEqual({
        providerId: "fal",
        modelId: "fal-ai/object-removal/mask",
      });
    });

    it("rejects Fal when FAL_KEY is missing", () => {
      liveEnv();
      expect(() => resolveProvider("REMOVE_BACKGROUND", { providerId: "fal" })).toThrow(DomainError);
      try {
        resolveProvider("REMOVE_BACKGROUND", { providerId: "fal" });
      } catch (error) {
        expect(error).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
      }
      expect(() => getFalCredentials()).toThrow(/Fal is not configured/);
    });

    it("rejects Google when GOOGLE_AI_API_KEY is missing", () => {
      liveEnv();
      try {
        resolveProvider("GENERATE", { providerId: "google" });
      } catch (error) {
        expect(error).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
      }
    });

    it("does not expose secrets on the public config surface", () => {
      liveEnv({ OPENAI_API_KEY: "sk-test-not-real", FAL_KEY: "fal_sk_test_not_real" });
      const runtime = getProviderRuntimeConfig();
      const publicStatus = publicProviderStatuses();
      expect(JSON.stringify(runtime)).not.toContain("sk-test-not-real");
      expect(JSON.stringify(runtime)).not.toContain("fal_sk_test_not_real");
      expect(JSON.stringify(publicStatus)).not.toContain("sk-test-not-real");
      expect(publicStatus.find((row) => row.id === "openai")?.configured).toBe(true);
      expect(publicStatus.find((row) => row.id === "fal")?.configured).toBe(true);
    });
  });

  describe("normalized errors", () => {
    it("maps HTTP 429, 5xx, and safety blocks", async () => {
      await expect(domainErrorFromProviderResponse(new Response("nope", { status: 429 }))).resolves.toMatchObject({
        code: "PROVIDER_RATE_LIMITED",
        status: 429,
      });
      await expect(domainErrorFromProviderResponse(new Response("nope", { status: 503 }))).resolves.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        status: 503,
      });
      const safety = new Response(JSON.stringify({ error: { message: "violates the content policy" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
      await expect(domainErrorFromProviderResponse(safety)).resolves.toMatchObject({
        code: "SAFETY_REJECTED",
        status: 400,
      });
    });

    it("marks rate limits, unavailability, and timeouts as retryable", () => {
      expect(isRetryableProviderCode("PROVIDER_RATE_LIMITED")).toBe(true);
      expect(isRetryableProviderCode("PROVIDER_UNAVAILABLE")).toBe(true);
      expect(isRetryableProviderCode("TIMEOUT")).toBe(true);
      expect(isRetryableProviderCode("PROVIDER_REJECTED")).toBe(false);
      expect(isRetryableProviderCode("PROVIDER_NOT_CONFIGURED")).toBe(false);
      expect(isRetryableProviderError(new DomainError("TIMEOUT", "The image provider timed out", 504))).toBe(true);
    });

    it("returns MODEL_DISABLED for catalog stubs that are not implemented yet", () => {
      liveEnv({ FAL_KEY: "fal_sk_test_not_real" });
      try {
        resolveProvider("GENERATE", { providerId: "fal" });
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toMatchObject({ code: "MODEL_DISABLED" });
      }
    });
  });

  describe("timeouts", () => {
    it("normalizes AbortError and TimeoutError to TIMEOUT", () => {
      expect(normalizeProviderError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toMatchObject({
        code: "TIMEOUT",
        status: 504,
      });
      expect(normalizeProviderError(Object.assign(new Error("timeout"), { name: "TimeoutError" }))).toMatchObject({
        code: "TIMEOUT",
        status: 504,
      });
    });

    it("maps an aborted OpenAI fetch to TIMEOUT without a live call", async () => {
      liveEnv({ OPENAI_API_KEY: "sk-test-not-real" });
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
      await expect(openaiGenerate({ prompt: "a mug" }, AbortSignal.timeout(1))).rejects.toMatchObject({
        code: "TIMEOUT",
      });
    });

    it("maps an aborted mock generate to TIMEOUT", async () => {
      await expect(mockGenerate({ prompt: "a mug" }, AbortSignal.abort())).rejects.toMatchObject({
        code: "TIMEOUT",
      });
    });
  });

  describe("mock provider execution", () => {
    it("returns a small PNG through the factory", async () => {
      const result = await runGenerate({ prompt: "a ceramic mug" }, AbortSignal.timeout(5_000));
      expect(result.rawModel).toBe("mock-png");
      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.mimeType).toBe("image/png");
      expect(result.images[0]?.width).toBe(32);
      expect(result.images[0]?.height).toBe(32);
      expect(result.images[0]?.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    });
  });

  describe("deferred vendor stubs", () => {
    it("does not call fetch from Fal or Google stubs", () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      expect(() => falUnimplemented("EDIT")).toThrow(DomainError);
      expect(() => googleUnimplemented("GENERATE")).toThrow(DomainError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe("provider timeout env", () => {
  it("parses Fal and Google timeout defaults without keys", () => {
    const env = loadEnv({ ...required });
    expect(env.FAL_TIMEOUT_MS).toBe(120_000);
    expect(env.GOOGLE_AI_TIMEOUT_MS).toBe(120_000);
    expect(env.GOOGLE_AI_BASE_URL).toBe("https://generativelanguage.googleapis.com");
  });
});
