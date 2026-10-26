import { describe, expect, it } from "vitest";
import {
  evaluateDeployConfig,
  formatPreflightText,
  isSecretEnvName,
  redactSecrets,
  REQUIRED_MIGRATIONS,
} from "@/lib/deploy/preflight";

const migrations = [...REQUIRED_MIGRATIONS];
const scripts = {
  start: "next start --hostname 0.0.0.0 --port 43127",
  worker: "tsx --require ./worker/register-server-only.cjs worker/index.ts",
  "db:deploy": "prisma migrate deploy",
  "test:live": "vitest run --config vitest.live.config.ts",
};
const dockerfiles = {
  dockerfileWeb: "CMD [\"sh\", \"-c\", \"pnpm exec next start --hostname 0.0.0.0 --port ${PORT:-43127}\"]",
  dockerfileWorker: 'CMD ["pnpm", "worker"]',
};

const baseEnv = {
  NODE_ENV: "production",
  APP_URL: "https://pixelforge.example",
  BETTER_AUTH_URL: "https://pixelforge.example",
  BETTER_AUTH_SECRET: "production-secret-production-secret-32",
  DATABASE_URL: "postgresql://pixelforge:pixelforge@127.0.0.1:5432/pixelforge",
  REDIS_URL: "redis://127.0.0.1:6379",
  S3_ENDPOINT: "https://s3.example",
  S3_BUCKET: "pixelforge-assets",
  S3_ACCESS_KEY_ID: "example-access-key",
  S3_SECRET_ACCESS_KEY: "example-secret-key",
};

function evaluate(env: Record<string, string | undefined> = baseEnv) {
  return evaluateDeployConfig({
    env,
    packageScripts: scripts,
    migrationNames: migrations,
    ...dockerfiles,
  });
}

describe("deployment preflight", () => {
  it("accepts a complete production configuration without printing secrets", () => {
    const report = evaluate();
    expect(report.ok).toBe(true);
    expect(report.connectivityAttempted).toBe(false);
    const text = formatPreflightText(report);
    expect(text).toContain("Deployment preflight: PASS");
    expect(text).not.toContain("production-secret");
    expect(text).not.toContain("example-secret-key");
    expect(text).not.toContain("postgresql://");
    expect(isSecretEnvName("BETTER_AUTH_SECRET")).toBe(true);
    expect(isSecretEnvName("APP_URL")).toBe(false);
  });

  it("requires S3 and Redis in production and rejects mock AI", () => {
    const incomplete = evaluate({
      ...baseEnv,
      REDIS_URL: "",
      S3_SECRET_ACCESS_KEY: "",
      AI_PROVIDER_MODE: "mock",
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.checks.find((check) => check.id === "config.s3")?.ok).toBe(false);
    expect(incomplete.checks.find((check) => check.id === "config.redis_url_production")?.ok).toBe(false);
    expect(incomplete.checks.find((check) => check.id === "config.mock_mode")?.ok).toBe(false);
    const text = formatPreflightText(incomplete);
    expect(text).not.toContain("example-access-key");
  });

  it("treats payment keys as optional at startup", () => {
    const report = evaluate({ ...baseEnv, STRIPE_SECRET_KEY: "", MIDTRANS_SERVER_KEY: "" });
    const payments = report.checks.find((check) => check.id === "config.payments");
    expect(payments?.ok).toBe(true);
    expect(payments?.required).toBe(false);
    expect(report.ok).toBe(true);
  });

  it("requires APP_URL https in production and a matching auth origin", () => {
    const report = evaluate({
      ...baseEnv,
      APP_URL: "http://pixelforge.example",
      BETTER_AUTH_URL: "https://other.example",
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "config.app_url")?.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "config.auth_url_match")?.ok).toBe(false);
  });

  it("reports missing migrations and invalid startup commands", () => {
    const report = evaluateDeployConfig({
      env: baseEnv,
      packageScripts: { start: "echo no", worker: "echo no", "db:deploy": "echo no" },
      migrationNames: migrations.slice(0, 2),
      dockerfileWeb: "FROM scratch",
      dockerfileWorker: "FROM scratch",
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "artifact.migrations")?.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "artifact.start_script")?.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "artifact.worker_server_only_shim")?.ok).toBe(false);
  });

  it("redacts URLs and secret values from incidental text", () => {
    const leaked = redactSecrets(
      "failed postgresql://pixelforge:super-secret@db/pixelforge password=super-secret",
    );
    expect(leaked).not.toContain("super-secret");
    expect(leaked).toContain("[redacted-url]");
  });

  it("allows incomplete S3 in development", () => {
    const report = evaluate({
      ...baseEnv,
      NODE_ENV: "development",
      APP_URL: "http://127.0.0.1:43127",
      BETTER_AUTH_URL: "http://127.0.0.1:43127",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_BUCKET: "",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
    });
    expect(report.checks.find((check) => check.id === "config.s3")?.required).toBe(false);
    expect(report.ok).toBe(true);
  });
});
