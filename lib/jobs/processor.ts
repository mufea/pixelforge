import { prisma } from "@/lib/db";
import { isRetryableProviderCode, isRetryableProviderError } from "@/lib/ai/errors";
import { getProviderTimeoutMs, resolveProvider, runGenerate, runRemoveBackground, runUpscale } from "@/lib/ai/factory";
import { isImageOperation } from "@/lib/ai/types";
import { detectImageMime, filenameForMime, isAllowedImageMime } from "@/lib/assets/mime";
import { persistDerivedAsset, rollbackDerivedAsset } from "@/lib/assets/persist";
import { assertResizeWithinLimits } from "@/lib/images/transform";
import { isUpscaleScaleFactor } from "@/lib/validators/job";
import { assertWithinQuota } from "@/lib/assets/quota";
import { getOwnedAsset } from "@/lib/assets/service";
import { validateAndSanitizeImage } from "@/lib/assets/validate-image";
import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { getStorage } from "@/lib/storage";
import { assertOwnedStorageKey } from "@/lib/storage/keys";
import type { ProviderResult } from "@/lib/ai/types";

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
    if (job.operation !== "GENERATE" && job.operation !== "REMOVE_BACKGROUND" && job.operation !== "UPSCALE") {
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
    if (job.operation === "REMOVE_BACKGROUND") {
      return await executeRemoveBackground(job);
    }
    if (job.operation === "UPSCALE") {
      return await executeUpscale(job);
    }
    return await executeGenerate(job);
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

async function executeGenerate(job: {
  id: string;
  userId: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  inputJson: unknown;
  attemptCount: number;
}) {
  const provider = resolveProvider("GENERATE", { providerId: job.providerId, modelId: job.modelId });
  const prompt = readPrompt(job.inputJson);
  const result = await runGenerate({ prompt }, AbortSignal.timeout(getProviderTimeoutMs(provider.providerId)), {
    providerId: provider.providerId,
    modelId: provider.modelId,
  });
  const image = requireProviderImage(result);

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

  return markJobSucceeded(job, result, asset.id);
}

async function executeRemoveBackground(job: {
  id: string;
  userId: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  inputJson: unknown;
  attemptCount: number;
}) {
  const env = getEnv();
  const assetId = readAssetId(job.inputJson);
  const source = await getOwnedAsset(job.userId, assetId);
  if (job.projectId && source.projectId !== job.projectId) {
    throw new DomainError("NOT_FOUND", "Asset not found", 404);
  }
  assertOwnedStorageKey(job.userId, source.storageKey);
  const stored = await getStorage().getObject(source.storageKey);
  if (!stored) {
    throw new DomainError("ASSET_BYTES_MISSING", "The original file is no longer in storage", 404);
  }
  if (stored.body.byteLength > env.MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The source file exceeds the size limit");
  }
  const detected = detectImageMime(stored.body);
  if (!detected || !isAllowedImageMime(detected)) {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }

  const provider = resolveProvider("REMOVE_BACKGROUND", { providerId: job.providerId, modelId: job.modelId });
  const result = await runRemoveBackground(
    { image: stored.body, mimeType: detected },
    AbortSignal.timeout(getProviderTimeoutMs(provider.providerId)),
    { providerId: provider.providerId, modelId: provider.modelId },
  );
  const image = requireProviderImage(result);
  if (image.mimeType !== "image/png") {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not return a PNG", 502);
  }

  const sanitized = await validateAndSanitizeImage(image.bytes, "image/png", {
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    maxImagePixels: env.MAX_IMAGE_PIXELS,
    maxImageEdgePx: env.MAX_IMAGE_EDGE_PX,
  });
  await assertWithinQuota(job.userId, sanitized.bytes.byteLength);

  const asset = await persistDerivedAsset({
    userId: job.userId,
    projectId: job.projectId,
    kind: "DERIVATIVE",
    mimeType: sanitized.mimeType,
    bytes: sanitized.bytes,
    width: sanitized.width,
    height: sanitized.height,
    originalFilename: filenameForMime(noBackgroundFilename(source.originalFilename), "image/png"),
    sourceAssetId: source.id,
    sourceJobId: job.id,
  });

  try {
    return await markJobSucceeded(job, result, asset.id);
  } catch (error) {
    await rollbackDerivedAsset(job.userId, asset);
    throw error;
  }
}

async function executeUpscale(job: {
  id: string;
  userId: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  inputJson: unknown;
  attemptCount: number;
}) {
  const env = getEnv();
  const assetId = readAssetId(job.inputJson);
  const scaleFactor = readScaleFactor(job.inputJson);
  const source = await getOwnedAsset(job.userId, assetId);
  if (job.projectId && source.projectId !== job.projectId) {
    throw new DomainError("NOT_FOUND", "Asset not found", 404);
  }
  assertOwnedStorageKey(job.userId, source.storageKey);
  const stored = await getStorage().getObject(source.storageKey);
  if (!stored) {
    throw new DomainError("ASSET_BYTES_MISSING", "The original file is no longer in storage", 404);
  }
  if (stored.body.byteLength > env.MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The source file exceeds the size limit");
  }
  const detected = detectImageMime(stored.body);
  if (!detected || !isAllowedImageMime(detected)) {
    throw new DomainError("VALIDATION_INVALID_SIGNATURE", "The source file is not a JPEG, PNG, or WebP image");
  }

  const limits = {
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    maxImagePixels: env.MAX_IMAGE_PIXELS,
    maxImageEdgePx: env.MAX_IMAGE_EDGE_PX,
  };
  assertResizeWithinLimits(source.width * scaleFactor, source.height * scaleFactor, limits);

  const provider = resolveProvider("UPSCALE", { providerId: job.providerId, modelId: job.modelId });
  const result = await runUpscale(
    { image: stored.body, mimeType: detected, scaleFactor },
    AbortSignal.timeout(getProviderTimeoutMs(provider.providerId)),
    { providerId: provider.providerId, modelId: provider.modelId },
  );
  const image = requireProviderImage(result);
  if (image.width < source.width || image.height < source.height) {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not upscale the image", 502);
  }
  assertResizeWithinLimits(image.width, image.height, limits);

  const sanitized = await validateAndSanitizeImage(image.bytes, image.mimeType, limits);
  await assertWithinQuota(job.userId, sanitized.bytes.byteLength);

  const asset = await persistDerivedAsset({
    userId: job.userId,
    projectId: job.projectId,
    kind: "DERIVATIVE",
    mimeType: sanitized.mimeType,
    bytes: sanitized.bytes,
    width: sanitized.width,
    height: sanitized.height,
    originalFilename: filenameForMime(upscaledFilename(source.originalFilename, scaleFactor), sanitized.mimeType),
    sourceAssetId: source.id,
    sourceJobId: job.id,
  });

  try {
    return await markJobSucceeded(job, result, asset.id);
  } catch (error) {
    await rollbackDerivedAsset(job.userId, asset);
    throw error;
  }
}

async function markJobSucceeded(
  job: { id: string; attemptCount: number },
  result: ProviderResult,
  outputAssetId: string,
) {
  const succeeded = await prisma.aIJob.update({
    where: { id: job.id },
    data: {
      status: "succeeded",
      finishedAt: new Date(),
      outputAssetIds: [outputAssetId],
      errorCode: null,
      errorMessage: null,
    },
  });
  await prisma.aIJobEvent.create({
    data: {
      jobId: job.id,
      fromStatus: "processing",
      toStatus: "succeeded",
      attempt: job.attemptCount,
      payloadJson: {
        latencyMs: result.latencyMs,
        providerRequestId: result.providerRequestId,
        model: result.rawModel,
        outputAssetId,
      },
    },
  });
  return succeeded;
}

function requireProviderImage(result: ProviderResult) {
  const image = result.images[0];
  if (!image) {
    throw new DomainError("PROVIDER_REJECTED", "The image provider returned no image");
  }
  return image;
}

function noBackgroundFilename(originalFilename: string) {
  return originalFilename.replace(/\.(jpe?g|png|webp)$/i, "") + "-no-bg.png";
}

function upscaledFilename(originalFilename: string, scaleFactor: number) {
  return originalFilename.replace(/\.(jpe?g|png|webp)$/i, "") + `-${scaleFactor}x.png`;
}

function readScaleFactor(inputJson: unknown) {
  if (typeof inputJson !== "object" || inputJson === null || !("scaleFactor" in inputJson)) {
    throw new DomainError("UNSUPPORTED_UPSCALE_FACTOR", "Upscale factor must be 2, 3, or 4");
  }
  const scaleFactor = (inputJson as { scaleFactor: unknown }).scaleFactor;
  if (!isUpscaleScaleFactor(scaleFactor)) {
    throw new DomainError("UNSUPPORTED_UPSCALE_FACTOR", "Upscale factor must be 2, 3, or 4");
  }
  return scaleFactor;
}

function readAssetId(inputJson: unknown) {
  if (typeof inputJson !== "object" || inputJson === null || !("assetId" in inputJson)) {
    throw new DomainError("VALIDATION", "Job is missing an asset");
  }
  const assetId = (inputJson as { assetId: unknown }).assetId;
  if (typeof assetId !== "string" || assetId.length < 8) {
    throw new DomainError("VALIDATION", "Job is missing an asset");
  }
  return assetId;
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
