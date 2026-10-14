import { getEnv } from "../lib/env";
import { logger } from "../lib/logging";

async function main() {
  const env = getEnv();
  logger.info(
    {
      redisConfigured: Boolean(env.REDIS_URL),
      jobsEnabled: env.AI_JOBS_ENABLED,
    },
    "PixelForge worker started. AI processors are registered in Phase 3.",
  );

  setInterval(() => {
    logger.info({ at: new Date().toISOString() }, "worker heartbeat");
  }, 30_000);
}

main().catch((error) => {
  logger.error({ err: error }, "Worker failed to start");
  process.exit(1);
});
