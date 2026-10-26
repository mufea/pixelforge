import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import {
  healthPayloadHasSensitiveFields,
  LIVENESS_KEYS,
  livenessPayload,
  READINESS_KEYS,
  readinessPayload,
} from "@/lib/health";

describe("health payloads", () => {
  it("exposes only liveness fields from GET /api/health", async () => {
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([...LIVENESS_KEYS].sort());
    expect(healthPayloadHasSensitiveFields(body)).toBe(false);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("pixelforge-web");
  });

  it("keeps readiness keys to status flags and a storage driver name", () => {
    const payload = readinessPayload({
      ok: true,
      postgres: "up",
      redis: "up",
      storage: "s3",
    });
    expect(Object.keys(payload).every((key) => (READINESS_KEYS as readonly string[]).includes(key))).toBe(
      true,
    );
    expect(healthPayloadHasSensitiveFields(payload)).toBe(false);
    expect(livenessPayload().service).toBe("pixelforge-web");
  });
});
