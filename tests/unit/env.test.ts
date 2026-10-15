import { describe, expect, it } from "vitest";
import { isGoogleOAuthConfigured, isS3Configured, loadEnv } from "@/lib/env";

const required = {
  APP_URL: "http://127.0.0.1:43127",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-12",
  DATABASE_URL: "postgresql://pixelforge:pixelforge@127.0.0.1:5432/pixelforge",
};

describe("environment parsing", () => {
  it("treats blank Google credentials as unconfigured", () => {
    const env = loadEnv({
      ...required,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "secret",
    });
    expect(isGoogleOAuthConfigured(env)).toBe(false);
  });

  it("enables Google only when both client id and secret are set", () => {
    const env = loadEnv({
      ...required,
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    });
    expect(isGoogleOAuthConfigured(env)).toBe(true);
  });

  it("rejects mock AI mode in production", () => {
    expect(() =>
      loadEnv({
        ...required,
        NODE_ENV: "production",
        AI_PROVIDER_MODE: "mock",
      }),
    ).toThrow(/mock is not allowed in production/);
  });

  it("treats incomplete S3 settings as unconfigured", () => {
    const env = loadEnv({
      ...required,
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_ACCESS_KEY_ID: "minioadmin",
    });
    expect(isS3Configured(env)).toBe(false);
  });

  it("requires a long Better Auth secret", () => {
    expect(() =>
      loadEnv({
        ...required,
        BETTER_AUTH_SECRET: "short",
      }),
    ).toThrow(/Invalid environment/);
  });
});
