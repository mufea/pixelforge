import { vi } from "vitest";
import { config } from "dotenv";

vi.mock("server-only", () => ({}));

config({ path: ".env" });
config({ path: ".env.local" });

Object.assign(process.env, { NODE_ENV: "test" });
process.env.APP_NAME ??= "PixelForge AI";
process.env.APP_URL ??= "http://127.0.0.1:43127";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-12";
process.env.DATABASE_URL ??=
  "postgresql://pixelforge:pixelforge@127.0.0.1:5432/pixelforge?schema=public";
// Tests use in-memory storage and in-process job recovery. Do not attach
// MinIO or Redis even if those URLs are present in a local .env.
delete process.env.S3_ENDPOINT;
delete process.env.S3_BUCKET;
delete process.env.S3_ACCESS_KEY_ID;
delete process.env.S3_SECRET_ACCESS_KEY;
delete process.env.REDIS_URL;
