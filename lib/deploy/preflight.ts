import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "@/lib/env";

export const REQUIRED_MIGRATIONS = [
  "20261014140142_phase1_foundation",
  "20261015104404_phase2_projects_assets",
  "20261016012526_phase3_convert_and_jobs",
  "20261017120000_phase46_credits",
] as const;

export const SECRET_ENV_NAMES = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "GOOGLE_CLIENT_SECRET",
  "RESEND_API_KEY",
  "SMTP_PASS",
  "OPENAI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "FAL_KEY",
  "FAL_API_KEY",
  "STABILITY_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "MIDTRANS_SERVER_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

export type PreflightScope = "web" | "worker" | "both";
export type PreflightKind = "config" | "artifact" | "connectivity";

export type PreflightCheck = {
  id: string;
  ok: boolean;
  required: boolean;
  scope: PreflightScope;
  kind: PreflightKind;
  summary: string;
};

export type PreflightReport = {
  ok: boolean;
  connectivityAttempted: boolean;
  checks: PreflightCheck[];
};

export type DeployConfigInput = {
  env: Record<string, string | undefined>;
  packageScripts: Record<string, string | undefined>;
  migrationNames: string[];
  dockerfileWeb: string;
  dockerfileWorker: string;
};

const S3_KEYS = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

export function isSecretEnvName(name: string) {
  return (SECRET_ENV_NAMES as readonly string[]).includes(name);
}

export function redactSecrets(text: string) {
  let redacted = text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "[redacted-url]");
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.length >= 4) {
      redacted = redacted.split(value).join("[redacted]");
    }
  }
  return redacted.replace(/(password|secret|token|apikey|api_key)=([^\s&]+)/gi, "$1=[redacted]");
}

export function evaluateDeployConfig(input: DeployConfigInput): PreflightReport {
  const env = input.env;
  const nodeEnv = env.NODE_ENV || "development";
  const production = nodeEnv === "production";
  const checks: PreflightCheck[] = [];

  checks.push(
    present("config.node_env", "both", env.NODE_ENV, "NODE_ENV is set", true),
    urlCheck("config.app_url", "both", env.APP_URL, "APP_URL", true, production),
    present("config.database_url", "both", env.DATABASE_URL, "DATABASE_URL is set", true),
    postgresUrlCheck(env.DATABASE_URL),
    secretLengthCheck(env.BETTER_AUTH_SECRET),
    optionalUrlCheck("config.better_auth_url", "web", env.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
    redisUrlCheck(env.REDIS_URL, production),
    s3Check(env, production),
    optionalUrlCheck("config.s3_endpoint_format", "both", env.S3_ENDPOINT, "S3_ENDPOINT"),
    providerPresence("config.fal_key", "FAL_KEY or FAL_API_KEY", Boolean(trim(env.FAL_KEY) || trim(env.FAL_API_KEY))),
    providerPresence("config.stability_key", "STABILITY_API_KEY", Boolean(trim(env.STABILITY_API_KEY))),
    providerPresence("config.openai_key", "OPENAI_API_KEY", Boolean(trim(env.OPENAI_API_KEY))),
    paymentsNotRequired(env),
    mockModeCheck(env),
    authUrlMatchesApp(env, production),
    migrationsCheck(input.migrationNames),
    scriptCheck("artifact.start_script", "web", input.packageScripts.start, "next start"),
    scriptCheck("artifact.worker_script", "worker", input.packageScripts.worker, "worker/index.ts"),
    scriptCheck("artifact.migrate_script", "both", input.packageScripts["db:deploy"], "prisma migrate deploy"),
    scriptCheck("artifact.live_test_script", "both", input.packageScripts["test:live"], "vitest.live.config.ts"),
    dockerfileCheck("artifact.dockerfile_web", "web", input.dockerfileWeb, "next start"),
    dockerfileCheck("artifact.dockerfile_worker", "worker", input.dockerfileWorker, 'CMD ["pnpm", "worker"]'),
    workerShimCheck(input.packageScripts.worker),
  );

  if (production) {
    checks.push(
      present("config.redis_url_production", "worker", env.REDIS_URL, "REDIS_URL is set for production workers", true),
    );
  }

  try {
    loadEnv(env);
    checks.push({
      id: "config.env_schema",
      ok: true,
      required: true,
      scope: "both",
      kind: "config",
      summary: "Shared env schema accepted the provided non-secret configuration",
    });
  } catch (error) {
    checks.push({
      id: "config.env_schema",
      ok: false,
      required: true,
      scope: "both",
      kind: "config",
      summary: redactSecrets(error instanceof Error ? error.message : "Invalid environment"),
    });
  }

  return {
    ok: checks.filter((check) => check.required).every((check) => check.ok),
    connectivityAttempted: false,
    checks,
  };
}

export async function runDeploymentPreflight(input: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  connect?: boolean;
}): Promise<PreflightReport> {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const [packageJson, dockerfileWeb, dockerfileWorker, migrationNames] = await Promise.all([
    readText(path.join(cwd, "package.json")),
    readText(path.join(cwd, "Dockerfile")),
    readText(path.join(cwd, "Dockerfile.worker")),
    listMigrations(path.join(cwd, "prisma", "migrations")),
  ]);
  const scripts = (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  const report = evaluateDeployConfig({
    env,
    packageScripts: scripts,
    migrationNames,
    dockerfileWeb,
    dockerfileWorker,
  });

  if (!input.connect) {
    report.checks.push({
      id: "connectivity.skipped",
      ok: true,
      required: false,
      scope: "both",
      kind: "connectivity",
      summary: "Connectivity was not attempted. Pass --connect to ping PostgreSQL and Redis only.",
    });
    return report;
  }

  report.connectivityAttempted = true;
  report.checks.push(await pingPostgres(env.DATABASE_URL));
  report.checks.push(await pingRedis(env.REDIS_URL));
  report.ok = report.checks.filter((check) => check.required).every((check) => check.ok);
  return report;
}

export function formatPreflightText(report: PreflightReport) {
  const lines = [
    report.ok ? "Deployment preflight: PASS" : "Deployment preflight: FAIL",
    report.connectivityAttempted
      ? "Connectivity: attempted (PostgreSQL SELECT 1, Redis PING). No migrations, uploads, or provider jobs were run."
      : "Connectivity: not attempted. Configuration presence only.",
    "",
  ];
  for (const check of report.checks) {
    const flag = check.ok ? "PASS" : check.required ? "FAIL" : "WARN";
    lines.push(`[${flag}] ${check.id} (${check.kind}/${check.scope}) ${check.summary}`);
  }
  return `${lines.join("\n")}\n`;
}

function present(
  id: string,
  scope: PreflightScope,
  value: string | undefined,
  summary: string,
  required: boolean,
): PreflightCheck {
  return {
    id,
    ok: Boolean(trim(value)),
    required,
    scope,
    kind: "config",
    summary: trim(value) ? summary : `${summary.replace(/ is set$/, "")} is missing`,
  };
}

function urlCheck(
  id: string,
  scope: PreflightScope,
  value: string | undefined,
  name: string,
  required: boolean,
  httpsInProduction: boolean,
): PreflightCheck {
  const trimmed = trim(value);
  if (!trimmed) {
    return { id, ok: !required, required, scope, kind: "config", summary: `${name} is missing` };
  }
  if (!isHttpUrl(trimmed)) {
    return { id, ok: false, required, scope, kind: "config", summary: `${name} is not a valid http(s) URL` };
  }
  if (httpsInProduction && !trimmed.startsWith("https://") && !trimmed.includes("localhost") && !trimmed.includes("127.0.0.1")) {
    return {
      id,
      ok: false,
      required,
      scope,
      kind: "config",
      summary: `${name} must be https in production`,
    };
  }
  return { id, ok: true, required, scope, kind: "config", summary: `${name} has a valid URL format` };
}

function optionalUrlCheck(id: string, scope: PreflightScope, value: string | undefined, name: string): PreflightCheck {
  const trimmed = trim(value);
  if (!trimmed) {
    return { id, ok: true, required: false, scope, kind: "config", summary: `${name} is unset` };
  }
  return urlCheck(id, scope, trimmed, name, false, false);
}

function postgresUrlCheck(value: string | undefined): PreflightCheck {
  const trimmed = trim(value);
  const ok = Boolean(trimmed && /^(postgres|postgresql):\/\//i.test(trimmed));
  return {
    id: "config.database_url_format",
    ok,
    required: true,
    scope: "both",
    kind: "config",
    summary: ok ? "DATABASE_URL uses a postgres URL scheme" : "DATABASE_URL must start with postgres:// or postgresql://",
  };
}

function redisUrlCheck(value: string | undefined, production: boolean): PreflightCheck {
  const trimmed = trim(value);
  if (!trimmed) {
    return {
      id: "config.redis_url_format",
      ok: true,
      required: false,
      scope: "worker",
      kind: "config",
      summary: production ? "REDIS_URL is missing" : "REDIS_URL is unset (worker will not consume the queue)",
    };
  }
  const ok = /^(redis|rediss):\/\//i.test(trimmed);
  return {
    id: "config.redis_url_format",
    ok,
    required: production,
    scope: "worker",
    kind: "config",
    summary: ok ? "REDIS_URL uses a redis URL scheme" : "REDIS_URL must start with redis:// or rediss://",
  };
}

function secretLengthCheck(value: string | undefined): PreflightCheck {
  const trimmed = trim(value);
  const ok = Boolean(trimmed && trimmed.length >= 32);
  return {
    id: "config.better_auth_secret",
    ok,
    required: true,
    scope: "both",
    kind: "config",
    summary: ok
      ? "BETTER_AUTH_SECRET is present and at least 32 characters"
      : "BETTER_AUTH_SECRET must be set and at least 32 characters",
  };
}

function s3Check(env: Record<string, string | undefined>, production: boolean): PreflightCheck {
  const presentKeys = S3_KEYS.filter((key) => trim(env[key]));
  const complete = presentKeys.length === S3_KEYS.length;
  const partial = presentKeys.length > 0 && !complete;
  if (production) {
    return {
      id: "config.s3",
      ok: complete,
      required: true,
      scope: "both",
      kind: "config",
      summary: complete
        ? "Production S3-compatible storage variables are all present"
        : "Production requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY",
    };
  }
  return {
    id: "config.s3",
    ok: !partial,
    required: false,
    scope: "both",
    kind: "config",
    summary: complete
      ? "S3-compatible storage variables are complete"
      : partial
        ? "S3 configuration is incomplete; local disk storage will be used in development"
        : "S3 is unset; development may use local disk storage",
  };
}

function providerPresence(id: string, name: string, presentValue: boolean): PreflightCheck {
  return {
    id,
    ok: true,
    required: false,
    scope: "both",
    kind: "config",
    summary: presentValue ? `${name} is present` : `${name} is unset (provider stays not-configured)`,
  };
}

function paymentsNotRequired(env: Record<string, string | undefined>): PreflightCheck {
  const anyPayment = Boolean(
    trim(env.STRIPE_SECRET_KEY) ||
      trim(env.STRIPE_WEBHOOK_SECRET) ||
      trim(env.MIDTRANS_SERVER_KEY) ||
      trim(env.MIDTRANS_CLIENT_KEY),
  );
  return {
    id: "config.payments",
    ok: true,
    required: false,
    scope: "web",
    kind: "config",
    summary: anyPayment
      ? "Payment keys are present but startup does not require them; Stripe/Midtrans remain a later slice"
      : "Payment keys are unset; startup does not require Stripe or Midtrans",
  };
}

function mockModeCheck(env: Record<string, string | undefined>): PreflightCheck {
  const production = env.NODE_ENV === "production";
  const mock = env.AI_PROVIDER_MODE === "mock";
  return {
    id: "config.mock_mode",
    ok: !(production && mock),
    required: true,
    scope: "both",
    kind: "config",
    summary:
      production && mock
        ? "AI_PROVIDER_MODE=mock is not allowed in production"
        : "AI_PROVIDER_MODE is valid for this NODE_ENV",
  };
}

function authUrlMatchesApp(env: Record<string, string | undefined>, production: boolean): PreflightCheck {
  const app = trim(env.APP_URL);
  const auth = trim(env.BETTER_AUTH_URL);
  if (!app || !auth) {
    return {
      id: "config.auth_url_match",
      ok: true,
      required: false,
      scope: "web",
      kind: "config",
      summary: "BETTER_AUTH_URL match skipped because one origin is unset",
    };
  }
  const ok = app === auth;
  return {
    id: "config.auth_url_match",
    ok: !production || ok,
    required: production,
    scope: "web",
    kind: "config",
    summary: ok ? "BETTER_AUTH_URL matches APP_URL" : "BETTER_AUTH_URL should match APP_URL in production",
  };
}

function migrationsCheck(names: string[]): PreflightCheck {
  const missing = REQUIRED_MIGRATIONS.filter((name) => !names.includes(name));
  return {
    id: "artifact.migrations",
    ok: missing.length === 0,
    required: true,
    scope: "both",
    kind: "artifact",
    summary:
      missing.length === 0
        ? "Required Prisma migrations are present on disk (not applied)"
        : `Missing migration directories: ${missing.join(", ")}`,
  };
}

function scriptCheck(
  id: string,
  scope: PreflightScope,
  script: string | undefined,
  needle: string,
): PreflightCheck {
  const ok = Boolean(script && script.includes(needle));
  return {
    id,
    ok,
    required: true,
    scope,
    kind: "artifact",
    summary: ok ? `package.json ${id.replace("artifact.", "")} includes ${needle}` : `package.json is missing a ${id.replace("artifact.", "")} that includes ${needle}`,
  };
}

function dockerfileCheck(id: string, scope: PreflightScope, contents: string, needle: string): PreflightCheck {
  const ok = contents.includes(needle);
  return {
    id,
    ok,
    required: true,
    scope,
    kind: "artifact",
    summary: ok ? `${id.replace("artifact.", "")} contains ${needle}` : `${id.replace("artifact.", "")} is missing ${needle}`,
  };
}

function workerShimCheck(script: string | undefined): PreflightCheck {
  const ok = Boolean(script && script.includes("register-server-only.cjs"));
  return {
    id: "artifact.worker_server_only_shim",
    ok,
    required: true,
    scope: "worker",
    kind: "artifact",
    summary: ok
      ? "Worker script stubs server-only before loading adapters"
      : "Worker script must --require worker/register-server-only.cjs",
  };
}

function trim(value: string | undefined) {
  const next = value?.trim();
  return next ? next : undefined;
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function readText(filePath: string) {
  return readFile(filePath, "utf8");
}

async function listMigrations(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function pingPostgres(url: string | undefined): Promise<PreflightCheck> {
  if (!trim(url)) {
    return {
      id: "connectivity.postgres",
      ok: false,
      required: true,
      scope: "both",
      kind: "connectivity",
      summary: "PostgreSQL connectivity skipped because DATABASE_URL is missing",
    };
  }
  try {
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
    });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return {
        id: "connectivity.postgres",
        ok: true,
        required: true,
        scope: "both",
        kind: "connectivity",
        summary: "PostgreSQL accepted SELECT 1",
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  } catch {
    return {
      id: "connectivity.postgres",
      ok: false,
      required: true,
      scope: "both",
      kind: "connectivity",
      summary: "PostgreSQL did not accept a connection",
    };
  }
}

async function pingRedis(url: string | undefined): Promise<PreflightCheck> {
  const redisUrl = trim(url);
  if (!redisUrl) {
    return {
      id: "connectivity.redis",
      ok: false,
      required: false,
      scope: "worker",
      kind: "connectivity",
      summary: "Redis connectivity skipped because REDIS_URL is missing",
    };
  }
  const Redis = (await import("ioredis")).default;
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    lazyConnect: true,
  });
  try {
    await client.connect();
    const pong = await client.ping();
    return {
      id: "connectivity.redis",
      ok: pong === "PONG",
      required: false,
      scope: "worker",
      kind: "connectivity",
      summary: pong === "PONG" ? "Redis accepted PING" : "Redis did not respond to PING",
    };
  } catch {
    return {
      id: "connectivity.redis",
      ok: false,
      required: false,
      scope: "worker",
      kind: "connectivity",
      summary: "Redis did not accept a connection",
    };
  } finally {
    client.disconnect();
  }
}
