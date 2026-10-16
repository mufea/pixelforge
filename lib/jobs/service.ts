import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { DomainError, notFound } from "@/lib/errors";
import { resolveProvider } from "@/lib/ai/generate";
import { getOwnedProject } from "@/lib/projects/service";
import { enqueueJob } from "@/lib/jobs/queue";
import { createGenerateJobSchema } from "@/lib/validators/job";

export async function createGenerateJob(userId: string, input: unknown) {
  const env = getEnv();
  if (!env.AI_JOBS_ENABLED) {
    throw new DomainError("AI_JOBS_DISABLED", "AI jobs are temporarily disabled", 503);
  }

  const parsed = createGenerateJobSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid job");
  }

  await getOwnedProject(userId, parsed.data.projectId);
  const provider = resolveProvider("GENERATE");
  const timeoutMs = env.JOB_DEFAULT_TIMEOUT_MS;

  const job = await prisma.aIJob.create({
    data: {
      userId,
      projectId: parsed.data.projectId,
      operation: "GENERATE",
      status: "queued",
      providerId: provider.providerId,
      modelId: provider.modelId,
      inputJson: { prompt: parsed.data.prompt, projectId: parsed.data.projectId },
      timeoutAt: new Date(Date.now() + timeoutMs),
    },
  });

  await prisma.aIJobEvent.create({
    data: { jobId: job.id, fromStatus: null, toStatus: "queued", attempt: 0 },
  });

  await enqueueJob(job.id);
  return job;
}

export async function getOwnedJob(userId: string, jobId: string) {
  const job = await prisma.aIJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!job) {
    notFound("Job not found");
  }
  return job;
}

export async function listProjectJobs(userId: string, projectId: string) {
  await getOwnedProject(userId, projectId);
  return prisma.aIJob.findMany({
    where: { userId, projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

export function publicJob(job: {
  id: string;
  operation: string;
  status: string;
  providerId: string;
  modelId: string;
  outputAssetIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}) {
  return {
    id: job.id,
    operation: job.operation,
    status: job.status,
    providerId: job.providerId,
    modelId: job.modelId,
    outputAssetIds: job.outputAssetIds,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}
