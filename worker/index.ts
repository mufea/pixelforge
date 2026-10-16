import "./load-env";
import { getEnv } from "../lib/env";
import { logger } from "../lib/logging";
import { startJobWorker } from "../lib/jobs/queue";

async function main() {
  const env = getEnv();
  const worker = startJobWorker();
  logger.info(
    {
      redisConfigured: Boolean(env.REDIS_URL),
      jobsEnabled: env.AI_JOBS_ENABLED,
      queueAttached: Boolean(worker),
    },
    "PixelForge worker started",
  );

  setInterval(() => {
    logger.info({ at: new Date().toISOString() }, "worker heartbeat");
  }, 30_000);
}

main().catch((error) => {
  logger.error({ err: error }, "Worker failed to start");
  process.exit(1);
});
