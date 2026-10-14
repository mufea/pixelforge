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
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
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

export function resetEnvCache() {
  cached = null;
}

export const PUBLIC_ENV_ALLOWLIST = ["STRIPE_PUBLISHABLE_KEY"] as const;
