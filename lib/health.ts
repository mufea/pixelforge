export const LIVENESS_KEYS = ["ok", "service", "timestamp"] as const;
export const READINESS_KEYS = ["ok", "postgres", "redis", "storage", "timestamp"] as const;

const SENSITIVE_HEALTH_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "BETTER_AUTH_SECRET",
  "FAL_KEY",
  "FAL_API_KEY",
  "STABILITY_API_KEY",
  "OPENAI_API_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "MIDTRANS_SERVER_KEY",
  "connectionString",
  "password",
  "secret",
] as const;

export function livenessPayload() {
  return {
    ok: true as const,
    service: "pixelforge-web",
    timestamp: new Date().toISOString(),
  };
}

export function readinessPayload(input: {
  ok: boolean;
  postgres: "up" | "down";
  redis?: "up" | "down" | "unconfigured";
  storage?: string;
}) {
  return {
    ok: input.ok,
    postgres: input.postgres,
    ...(input.redis ? { redis: input.redis } : {}),
    ...(input.storage ? { storage: input.storage } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function healthPayloadHasSensitiveFields(payload: Record<string, unknown>) {
  const keys = Object.keys(payload);
  return keys.some((key) =>
    SENSITIVE_HEALTH_KEYS.some((forbidden) => key.toLowerCase() === forbidden.toLowerCase()),
  );
}
