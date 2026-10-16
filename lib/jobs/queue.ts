import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { getEnv } from "@/lib/env";
import { processJob } from "@/lib/jobs/processor";
import { logger } from "@/lib/logging";

let queue: Queue | null = null;
let connection: IORedis | null = null;

function redis() {
  const env = getEnv();
  if (!env.REDIS_URL) {
    return null;
  }
  connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

export function jobsQueueName() {
  return "jobs";
}

function queueOptions(connection: IORedis) {
  return { connection, prefix: getEnv().QUEUE_PREFIX };
}

export async function enqueueJob(jobId: string) {
  const env = getEnv();
  const conn = redis();
  if (conn && env.NODE_ENV !== "test") {
    queue ??= new Queue(jobsQueueName(), queueOptions(conn));
    await queue.add("process", { jobId }, { jobId, attempts: 3, backoff: { type: "exponential", delay: 2000 } });
    return;
  }
  if (env.NODE_ENV === "test") {
    return;
  }
  void processJob(jobId).catch((error) => {
    logger.error({ err: error, jobId }, "In-process job failed");
  });
}

export function startJobWorker() {
  const conn = redis();
  if (!conn) {
    logger.warn("REDIS_URL is not set; worker will not consume the queue");
    return null;
  }
  return new Worker(
    jobsQueueName(),
    async (job) => {
      const jobId = String(job.data.jobId ?? "");
      await processJob(jobId);
    },
    { ...queueOptions(conn), concurrency: 2 },
  );
}
