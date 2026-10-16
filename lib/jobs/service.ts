import { resolveProvider } from "@/lib/ai/generate";
import { isAllowedImageMime } from "@/lib/assets/mime";
import { assertWithinQuota } from "@/lib/assets/quota";
import { getOwnedAsset } from "@/lib/assets/service";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { DomainError, notFound } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/queue";
import { getOwnedProject } from "@/lib/projects/service";
import { assertResizeWithinLimits } from "@/lib/images/transform";
import {
  createGenerateJobSchema,
  createRemoveBackgroundJobSchema,
  createUpscaleJobSchema,
} from "@/lib/validators/job";

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

export async function createRemoveBackgroundJob(userId: string, input: unknown) {
  const env = getEnv();
  if (!env.AI_JOBS_ENABLED) {
    throw new DomainError("AI_JOBS_DISABLED", "AI jobs are temporarily disabled", 503);
  }

  const parsed = createRemoveBackgroundJobSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid job");
  }

  await getOwnedProject(userId, parsed.data.projectId);
  const source = await getOwnedAsset(userId, parsed.data.assetId);
  if (source.projectId !== parsed.data.projectId) {
    notFound("Asset not found");
  }
  if (!isAllowedImageMime(source.mimeType)) {
    throw new DomainError("VALIDATION_INVALID_MIME", "Only JPEG, PNG, and WebP images can have a background removed");
  }
  if (source.byteSize > env.MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The source file exceeds the size limit");
  }

  await assertWithinQuota(userId, source.byteSize);
  const provider = resolveProvider("REMOVE_BACKGROUND");
  const timeoutMs = env.JOB_DEFAULT_TIMEOUT_MS;

  const job = await prisma.aIJob.create({
    data: {
      userId,
      projectId: parsed.data.projectId,
      operation: "REMOVE_BACKGROUND",
      status: "queued",
      providerId: provider.providerId,
      modelId: provider.modelId,
      inputJson: {
        projectId: parsed.data.projectId,
        assetId: source.id,
        inputAssetIds: [source.id],
      },
      timeoutAt: new Date(Date.now() + timeoutMs),
    },
  });

  await prisma.aIJobEvent.create({
    data: { jobId: job.id, fromStatus: null, toStatus: "queued", attempt: 0 },
  });

  await enqueueJob(job.id);
  return job;
}

export async function createUpscaleJob(userId: string, input: unknown) {
  const env = getEnv();
  if (!env.AI_JOBS_ENABLED) {
    throw new DomainError("AI_JOBS_DISABLED", "AI jobs are temporarily disabled", 503);
  }

  const parsed = createUpscaleJobSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "scaleFactor") {
      throw new DomainError("UNSUPPORTED_UPSCALE_FACTOR", "Upscale factor must be 2, 3, or 4");
    }
    throw new DomainError("VALIDATION", issue?.message ?? "Invalid job");
  }

  await getOwnedProject(userId, parsed.data.projectId);
  const source = await getOwnedAsset(userId, parsed.data.assetId);
  if (source.projectId !== parsed.data.projectId) {
    notFound("Asset not found");
  }
  if (!isAllowedImageMime(source.mimeType)) {
    throw new DomainError("VALIDATION_INVALID_MIME", "Only JPEG, PNG, and WebP images can be upscaled");
  }
  if (source.byteSize > env.MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The source file exceeds the size limit");
  }

  const scaleFactor = parsed.data.scaleFactor;
  assertResizeWithinLimits(source.width * scaleFactor, source.height * scaleFactor, {
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    maxImagePixels: env.MAX_IMAGE_PIXELS,
    maxImageEdgePx: env.MAX_IMAGE_EDGE_PX,
  });
  await assertWithinQuota(userId, source.byteSize * scaleFactor * scaleFactor);
  const provider = resolveProvider("UPSCALE");
  const timeoutMs = env.JOB_DEFAULT_TIMEOUT_MS;

  const job = await prisma.aIJob.create({
    data: {
      userId,
      projectId: parsed.data.projectId,
      operation: "UPSCALE",
      status: "queued",
      providerId: provider.providerId,
      modelId: provider.modelId,
      inputJson: {
        projectId: parsed.data.projectId,
        assetId: source.id,
        inputAssetIds: [source.id],
        scaleFactor,
      },
      timeoutAt: new Date(Date.now() + timeoutMs),
    },
  });

  await prisma.aIJobEvent.create({
    data: { jobId: job.id, fromStatus: null, toStatus: "queued", attempt: 0 },
  });

  await enqueueJob(job.id);
  return job;
}

export async function createStudioJob(userId: string, input: unknown) {
  if (typeof input === "object" && input !== null && "operation" in input) {
    if (input.operation === "REMOVE_BACKGROUND") {
      return createRemoveBackgroundJob(userId, input);
    }
    if (input.operation === "UPSCALE") {
      return createUpscaleJob(userId, input);
    }
  }
  return createGenerateJob(userId, input);
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
