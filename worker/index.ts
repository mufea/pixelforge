import "./load-env";
import { getEnv } from "../lib/env";
import { startJobWorker, stopJobRuntime } from "../lib/jobs/queue";
import { logger } from "../lib/logging";

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

  const heartbeat = setInterval(() => {
    logger.info({ at: new Date().toISOString() }, "worker heartbeat");
  }, 30_000);
  heartbeat.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(heartbeat);
    logger.info({ signal }, "Worker shutting down");
    try {
      await stopJobRuntime();
      process.exitCode = 0;
    } catch (error) {
      logger.error({ err: error }, "Worker shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((error) => {
  logger.error({ err: error }, "Worker failed to start");
  process.exit(1);
});
