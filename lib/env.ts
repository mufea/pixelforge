import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    if (!value || value.trim() === "") return undefined;
    return value;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().default("PixelForge AI"),
  APP_URL: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  AI_PROVIDER_MODE: z.enum(["live", "mock"]).default("live"),
  PUBLIC_API_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: optionalString,
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  EMAIL_FROM: z.string().default("PixelForge AI <noreply@localhost>"),
  RESEND_API_KEY: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: optionalString,
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  OPENAI_API_KEY: optionalString,
  GOOGLE_AI_API_KEY: optionalString,
  FAL_KEY: optionalString,
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PUBLISHABLE_KEY: optionalString,
  MIDTRANS_SERVER_KEY: optionalString,
  MIDTRANS_CLIENT_KEY: optionalString,
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  S3_PRESIGN_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  S3_PRESIGN_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20_971_520),
  MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(25_000_000),
  MAX_IMAGE_EDGE_PX: z.coerce.number().int().positive().default(8192),
  STORAGE_QUOTA_BYTES: z.coerce.number().int().positive().default(1_073_741_824),
  STORAGE_LOCAL_DIR: z.string().default(".storage"),
  UPLOAD_INTENT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().nonnegative().default(30),
  AI_JOBS_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }

  const env = parsed.data;
  if (env.NODE_ENV === "production" && env.AI_PROVIDER_MODE === "mock") {
    throw new Error("AI_PROVIDER_MODE=mock is not allowed in production");
  }
  return env;
}

export function getEnv(): AppEnv {
  if (!cached) {
    cached = loadEnv();
  }
  return cached;
}

export function isGoogleOAuthConfigured(
  env: Pick<AppEnv, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"> = getEnv(),
): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function isS3Configured(
  env: Pick<AppEnv, "S3_ENDPOINT" | "S3_BUCKET" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY"> = getEnv(),
): boolean {
  return Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

export function resetEnvCache() {
  cached = null;
}

export const PUBLIC_ENV_ALLOWLIST = ["STRIPE_PUBLISHABLE_KEY"] as const;
