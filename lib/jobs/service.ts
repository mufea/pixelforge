import { randomUUID } from "node:crypto";
import { resolveProvider } from "@/lib/ai/factory";
import { isAllowedImageMime } from "@/lib/assets/mime";
import { assertWithinQuota } from "@/lib/assets/quota";
import { getOwnedAsset } from "@/lib/assets/service";
import { getCreditCost } from "@/lib/billing/pricing";
import { reserveCredits } from "@/lib/billing/service";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { DomainError, notFound } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/queue";
import { logger } from "@/lib/logging";
import { getOwnedProject } from "@/lib/projects/service";
import { assertResizeWithinLimits } from "@/lib/images/transform";
import {
  createEditJobSchema,
  createGenerateJobSchema,
  createImageToImageJobSchema,
  createRemoveBackgroundJobSchema,
  createRemoveObjectJobSchema,
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

  return createQueuedBillableJob({
    userId,
    projectId: parsed.data.projectId,
    operation: "GENERATE",
    providerId: provider.providerId,
    modelId: provider.modelId,
    inputJson: { prompt: parsed.data.prompt, projectId: parsed.data.projectId },
    timeoutMs: env.JOB_DEFAULT_TIMEOUT_MS,
  });
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

  return createQueuedBillableJob({
    userId,
    projectId: parsed.data.projectId,
    operation: "REMOVE_BACKGROUND",
    providerId: provider.providerId,
    modelId: provider.modelId,
    inputJson: {
      projectId: parsed.data.projectId,
      assetId: source.id,
      inputAssetIds: [source.id],
    },
    timeoutMs: env.JOB_DEFAULT_TIMEOUT_MS,
  });
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

  return createQueuedBillableJob({
    userId,
    projectId: parsed.data.projectId,
    operation: "UPSCALE",
    providerId: provider.providerId,
    modelId: provider.modelId,
    inputJson: {
      projectId: parsed.data.projectId,
      assetId: source.id,
      inputAssetIds: [source.id],
      scaleFactor,
    },
    timeoutMs: env.JOB_DEFAULT_TIMEOUT_MS,
    scaleFactor,
  });
}

export async function createEditJob(userId: string, input: unknown) {
  const env = getEnv();
  if (!env.AI_JOBS_ENABLED) {
    throw new DomainError("AI_JOBS_DISABLED", "AI jobs are temporarily disabled", 503);
  }

  const parsed = createEditJobSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid job");
  }

  await getOwnedProject(userId, parsed.data.projectId);
  const source = await requireOwnedSourceImage(userId, parsed.data.projectId, parsed.data.assetId);
  let mask = null;
  if (parsed.data.maskAssetId) {
    mask = await requireOwnedMask(userId, parsed.data.projectId, parsed.data.maskAssetId, source);
  }

  await assertWithinQuota(userId, source.byteSize);
  const provider = resolveProvider("EDIT");

  return createQueuedBillableJob({
    userId,
    projectId: parsed.data.projectId,
    operation: "EDIT",
    providerId: provider.providerId,
    modelId: provider.modelId,
    inputJson: {
      projectId: parsed.data.projectId,
      assetId: source.id,
      inputAssetIds: mask ? [source.id, mask.id] : [source.id],
      prompt: parsed.data.prompt,
      ...(mask ? { maskAssetId: mask.id } : {}),
    },
    timeoutMs: env.JOB_DEFAULT_TIMEOUT_MS,
  });
}

export async function createRemoveObjectJob(userId: string, input: unknown) {
  const env = getEnv();
  if (!env.AI_JOBS_ENABLED) {
    throw new DomainError("AI_JOBS_DISABLED", "AI jobs are temporarily disabled", 503);
  }

  const parsed = createRemoveObjectJobSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "maskAssetId") {
      throw new DomainError("MASK_REQUIRED", "Object removal requires a PNG mask of the same size as the source");
    }
    throw new DomainError("VALIDATION", issue?.message ?? "Invalid job");
  }

  await getOwnedProject(userId, parsed.data.projectId);
  const source = await requireOwnedSourceImage(userId, parsed.data.projectId, parsed.data.assetId);
  const mask = await requireOwnedMask(userId, parsed.data.projectId, parsed.data.maskAssetId, source);

  await assertWithinQuota(userId, source.byteSize);
  const provider = resolveProvider("REMOVE_OBJECT");

  return createQueuedBillableJob({
    userId,
    projectId: parsed.data.projectId,
    operation: "REMOVE_OBJECT",
    providerId: provider.providerId,
    modelId: provider.modelId,
    inputJson: {
      projectId: parsed.data.projectId,
      assetId: source.id,
      maskAssetId: mask.id,
      inputAssetIds: [source.id, mask.id],
    },
    timeoutMs: env.JOB_DEFAULT_TIMEOUT_MS,
  });
}

export async function createImageToImageJob(userId: string, input: unknown) {
  const env = getEnv();
  if (!env.AI_JOBS_ENABLED) {
    throw new DomainError("AI_JOBS_DISABLED", "AI jobs are temporarily disabled", 503);
  }

  const parsed = createImageToImageJobSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "strength") {
      throw new DomainError("VALIDATION", "strength must be between 0.01 and 1");
    }
    throw new DomainError("VALIDATION", issue?.message ?? "Invalid job");
  }

  await getOwnedProject(userId, parsed.data.projectId);
  const source = await requireOwnedSourceImage(userId, parsed.data.projectId, parsed.data.assetId);
  await assertWithinQuota(userId, source.byteSize);
  const provider = resolveProvider("IMAGE_TO_IMAGE");

  return createQueuedBillableJob({
    userId,
    projectId: parsed.data.projectId,
    operation: "IMAGE_TO_IMAGE",
    providerId: provider.providerId,
    modelId: provider.modelId,
    inputJson: {
      projectId: parsed.data.projectId,
      assetId: source.id,
      inputAssetIds: [source.id],
      prompt: parsed.data.prompt,
      ...(parsed.data.strength !== undefined ? { strength: parsed.data.strength } : {}),
    },
    timeoutMs: env.JOB_DEFAULT_TIMEOUT_MS,
  });
}

export async function createQueuedBillableJob(input: {
  userId: string;
  projectId: string | null;
  operation: "GENERATE" | "EDIT" | "REMOVE_BACKGROUND" | "REMOVE_OBJECT" | "UPSCALE" | "IMAGE_TO_IMAGE";
  providerId: string;
  modelId: string;
  inputJson: Record<string, unknown>;
  timeoutMs: number;
  scaleFactor?: unknown;
}) {
  const credits = getCreditCost({ operation: input.operation, scaleFactor: input.scaleFactor });
  const jobId = randomUUID();
  const reservationId = randomUUID();

  const job = await prisma.$transaction(async (tx) => {
    await reserveCredits(
      {
        userId: input.userId,
        credits,
        jobId,
        reservationId,
        operation: input.operation,
      },
      tx,
    );
    const created = await tx.aIJob.create({
      data: {
        id: jobId,
        userId: input.userId,
        projectId: input.projectId,
        operation: input.operation,
        status: "queued",
        providerId: input.providerId,
        modelId: input.modelId,
        inputJson: input.inputJson as Prisma.InputJsonValue,
        reservationId,
        timeoutAt: new Date(Date.now() + input.timeoutMs),
      },
    });
    await tx.aIJobEvent.create({
      data: { jobId: created.id, fromStatus: null, toStatus: "queued", attempt: 0 },
    });
    return created;
  });

  try {
    await enqueueJob(job.id);
  } catch (error) {
    logger.error(
      { err: error, jobId: job.id },
      "Queue publication failed after the billing transaction committed; job remains queued for recovery",
    );
    throw error;
  }
  return job;
}

async function requireOwnedSourceImage(userId: string, projectId: string, assetId: string) {
  const env = getEnv();
  const source = await getOwnedAsset(userId, assetId);
  if (source.projectId !== projectId) {
    notFound("Asset not found");
  }
  if (!isAllowedImageMime(source.mimeType)) {
    throw new DomainError("VALIDATION_INVALID_MIME", "Only JPEG, PNG, and WebP images can be used");
  }
  if (source.byteSize > env.MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The source file exceeds the size limit");
  }
  return source;
}

async function requireOwnedMask(
  userId: string,
  projectId: string,
  maskAssetId: string,
  source: { id: string; width: number; height: number },
) {
  const env = getEnv();
  if (maskAssetId === source.id) {
    throw new DomainError("VALIDATION_MASK", "The mask must be a separate PNG from the source image");
  }
  const mask = await getOwnedAsset(userId, maskAssetId);
  if (mask.projectId !== projectId) {
    notFound("Asset not found");
  }
  if (mask.mimeType !== "image/png") {
    throw new DomainError("VALIDATION_INVALID_MIME", "Masks must be PNG images");
  }
  if (mask.width !== source.width || mask.height !== source.height) {
    throw new DomainError("VALIDATION_MASK_SIZE", "The mask must match the source image dimensions");
  }
  if (mask.byteSize > env.MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The mask file exceeds the size limit");
  }
  return mask;
}

export async function createStudioJob(userId: string, input: unknown) {
  if (typeof input === "object" && input !== null && "operation" in input) {
    if (input.operation === "REMOVE_BACKGROUND") {
      return createRemoveBackgroundJob(userId, input);
    }
    if (input.operation === "UPSCALE") {
      return createUpscaleJob(userId, input);
    }
    if (input.operation === "EDIT") {
      return createEditJob(userId, input);
    }
    if (input.operation === "REMOVE_OBJECT") {
      return createRemoveObjectJob(userId, input);
    }
    if (input.operation === "IMAGE_TO_IMAGE") {
      return createImageToImageJob(userId, input);
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
