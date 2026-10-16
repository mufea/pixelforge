import { prisma } from "@/lib/db";
import { isRetryableProviderCode, isRetryableProviderError } from "@/lib/ai/errors";
import { getProviderTimeoutMs, resolveProvider, runGenerate } from "@/lib/ai/factory";
import { isImageOperation } from "@/lib/ai/types";
import { persistDerivedAsset } from "@/lib/assets/persist";
import { filenameForMime } from "@/lib/assets/mime";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logging";

export async function processJob(jobId: string) {
  const existing = await prisma.aIJob.findUnique({ where: { id: jobId } });
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Job not found", 404);
  }
  if (existing.status === "succeeded" || existing.status === "cancelled") {
    return existing;
  }
  if (existing.status === "failed" && existing.errorCode && !isRetryableProviderCode(existing.errorCode)) {
    return existing;
  }
  if (
    existing.status === "processing" &&
    existing.timeoutAt &&
    existing.timeoutAt.getTime() > Date.now()
  ) {
    return existing;
  }

  const claimed = await prisma.aIJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: { in: ["queued", "failed"] } },
        { status: "processing", timeoutAt: { lt: new Date() } },
      ],
    },
    data: {
      status: "processing",
      startedAt: existing.startedAt ?? new Date(),
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    return prisma.aIJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  const job = await prisma.aIJob.findUniqueOrThrow({ where: { id: jobId } });
  await prisma.aIJobEvent.create({
    data: {
      jobId,
      fromStatus: existing.status,
      toStatus: "processing",
      attempt: job.attemptCount,
    },
  });

  try {
    if (job.operation !== "GENERATE") {
      throw new DomainError(
        isImageOperation(job.operation) ? "MODEL_CAPABILITY_UNSUPPORTED" : "VALIDATION",
        "Unsupported job operation",
        400,
      );
    }
    const reused = await reuseExistingOutput(jobId);
    if (reused) {
      return reused;
    }
    const provider = resolveProvider("GENERATE", { providerId: job.providerId, modelId: job.modelId });
    const prompt = readPrompt(job.inputJson);
    const result = await runGenerate({ prompt }, AbortSignal.timeout(getProviderTimeoutMs(provider.providerId)), {
      providerId: provider.providerId,
      modelId: provider.modelId,
    });
    const image = result.images[0];
    if (!image) {
      throw new DomainError("PROVIDER_REJECTED", "The image provider returned no image");
    }

    const asset = await persistDerivedAsset({
      userId: job.userId,
      projectId: job.projectId,
      kind: "GENERATED",
      mimeType: image.mimeType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      originalFilename: filenameForMime("generated.png", image.mimeType),
      sourceJobId: job.id,
    });

    const succeeded = await prisma.aIJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        outputAssetIds: [asset.id],
        errorCode: null,
        errorMessage: null,
      },
    });
    await prisma.aIJobEvent.create({
      data: {
        jobId,
        fromStatus: "processing",
        toStatus: "succeeded",
        attempt: job.attemptCount,
        payloadJson: {
          latencyMs: result.latencyMs,
          providerRequestId: result.providerRequestId,
          model: result.rawModel,
          outputAssetId: asset.id,
        },
      },
    });
    return succeeded;
  } catch (error) {
    const code = error instanceof DomainError ? error.code : "JOB_FAILED";
    const message = error instanceof DomainError ? error.message : "The job failed";
    const retryable = isRetryableProviderError(error) || isRetryableProviderCode(code);
    logger.error({ jobId, code }, "Job processing failed");

    if (retryable && job.attemptCount < 3) {
      await prisma.aIJob.update({
        where: { id: jobId },
        data: { status: "queued", errorCode: code, errorMessage: message },
      });
      throw error;
    }

    const failed = await prisma.aIJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorCode: code,
        errorMessage: message,
      },
    });
    await prisma.aIJobEvent.create({
      data: {
        jobId,
        fromStatus: "processing",
        toStatus: "failed",
        attempt: job.attemptCount,
        payloadJson: { code },
      },
    });
    if (!retryable) {
      return failed;
    }
    throw error;
  }
}

async function reuseExistingOutput(jobId: string) {
  const existing = await prisma.asset.findFirst({
    where: { sourceJobId: jobId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!existing) {
    return null;
  }

  const succeeded = await prisma.aIJob.update({
    where: { id: jobId },
    data: {
      status: "succeeded",
      finishedAt: new Date(),
      outputAssetIds: [existing.id],
      errorCode: null,
      errorMessage: null,
    },
  });
  await prisma.aIJobEvent.create({
    data: {
      jobId,
      fromStatus: "processing",
      toStatus: "succeeded",
      attempt: succeeded.attemptCount,
      payloadJson: { reusedAssetId: existing.id },
    },
  });
  return succeeded;
}

function readPrompt(inputJson: unknown) {
  if (typeof inputJson !== "object" || inputJson === null || !("prompt" in inputJson)) {
    throw new DomainError("VALIDATION", "Job is missing a prompt");
  }
  const prompt = (inputJson as { prompt: unknown }).prompt;
  if (typeof prompt !== "string" || prompt.trim().length < 3) {
    throw new DomainError("VALIDATION", "Job is missing a prompt");
  }
  return prompt.trim();
}
