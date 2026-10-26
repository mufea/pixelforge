import { prisma } from "@/lib/db";
import { isRetryableJobCode, isRetryableProviderError } from "@/lib/ai/errors";
import {
  getProviderTimeoutMs,
  resolveProvider,
  runEdit,
  runGenerate,
  runImageToImage,
  runRemoveBackground,
  runRemoveObject,
  runUpscale,
} from "@/lib/ai/factory";
import { isImageOperation } from "@/lib/ai/types";
import { detectImageMime, filenameForMime, isAllowedImageMime } from "@/lib/assets/mime";
import { persistDerivedAsset } from "@/lib/assets/persist";
import { assertResizeWithinLimits } from "@/lib/images/transform";
import { isUpscaleScaleFactor } from "@/lib/validators/job";
import { assertWithinQuota } from "@/lib/assets/quota";
import { getOwnedAsset } from "@/lib/assets/service";
import { validateAndSanitizeImage } from "@/lib/assets/validate-image";
import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { reconcileJobCredits, shouldReleaseCreditsForFailure } from "@/lib/jobs/credits";
import { releaseCredits, settleCredits } from "@/lib/billing/service";
import { logger } from "@/lib/logging";
import { getStorage } from "@/lib/storage";
import { assertCompatibleMask, assertMaskHasSelection } from "@/lib/assets/mask";
import { assertOwnedStorageKey } from "@/lib/storage/keys";
import type { ProviderResult } from "@/lib/ai/types";

export async function processJob(jobId: string) {
  const existing = await prisma.aIJob.findUnique({ where: { id: jobId } });
  if (!existing) {
    throw new DomainError("NOT_FOUND", "Job not found", 404);
  }
  if (existing.status === "succeeded" || existing.status === "cancelled") {
    await reconcileJobCredits(existing);
    return existing;
  }
  if (existing.status === "failed" && existing.errorCode && !isRetryableJobCode(existing.errorCode)) {
    await reconcileJobCredits(existing);
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
    const current = await prisma.aIJob.findUniqueOrThrow({ where: { id: jobId } });
    await reconcileJobCredits(current);
    return current;
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
    if (
      job.operation !== "GENERATE" &&
      job.operation !== "REMOVE_BACKGROUND" &&
      job.operation !== "UPSCALE" &&
      job.operation !== "EDIT" &&
      job.operation !== "REMOVE_OBJECT" &&
      job.operation !== "IMAGE_TO_IMAGE"
    ) {
      throw new DomainError(
        isImageOperation(job.operation) ? "MODEL_CAPABILITY_UNSUPPORTED" : "VALIDATION",
        "Unsupported job operation",
        400,
      );
    }
    const reused = await reuseExistingOutput(job);
    if (reused) {
      return reused;
    }
    if (job.operation === "REMOVE_BACKGROUND") {
      return await executeRemoveBackground(job);
    }
    if (job.operation === "UPSCALE") {
      return await executeUpscale(job);
    }
    if (job.operation === "EDIT") {
      return await executeEdit(job);
    }
    if (job.operation === "REMOVE_OBJECT") {
      return await executeRemoveObject(job);
    }
    if (job.operation === "IMAGE_TO_IMAGE") {
      return await executeImageToImage(job);
    }
    return await executeGenerate(job);
  } catch (error) {
    const code = error instanceof DomainError ? error.code : "JOB_FAILED";
    const message = error instanceof DomainError ? error.message : "The job failed";
    const retryable = isRetryableProviderError(error) || isRetryableJobCode(code);
    logger.error({ jobId, code }, "Job processing failed");

    if (retryable && job.attemptCount < 3) {
      await prisma.aIJob.update({
        where: { id: jobId },
        data: { status: "queued", errorCode: code, errorMessage: message },
      });
      throw error;
    }

    const persistedOutput = await prisma.asset.findFirst({
      where: { sourceJobId: jobId, deletedAt: null },
    });
    if (persistedOutput) {
      await prisma.aIJob.update({
        where: { id: jobId },
        data: { status: "queued", errorCode: code, errorMessage: message },
      });
      logger.error(
        { jobId, code },
        "Job has output but completion/settlement failed; requeued without releasing credits",
      );
      throw error;
    }

    const failed = await prisma.$transaction(async (tx) => {
      const updated = await tx.aIJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          errorCode: code,
          errorMessage: message,
        },
      });
      await tx.aIJobEvent.create({
        data: {
          jobId,
          fromStatus: "processing",
          toStatus: "failed",
          attempt: job.attemptCount,
          payloadJson: { code },
        },
      });
      if (shouldReleaseCreditsForFailure(code)) {
        await releaseCredits(
          { userId: job.userId, jobId, reservationId: job.reservationId },
          tx,
        );
      }
      return updated;
    });
    if (!retryable) {
      return failed;
    }
    throw error;
  }
}

async function reuseExistingOutput(job: {
  id: string;
  userId: string;
  reservationId: string | null;
  attemptCount: number;
}) {
  const existing = await prisma.asset.findFirst({
    where: { sourceJobId: job.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!existing) {
    return null;
  }

  return markJobSucceeded(job, { latencyMs: 0, rawModel: "reused", images: [] }, existing.id, {
    reusedAssetId: existing.id,
  });
}

async function executeGenerate(job: {
  id: string;
  userId: string;
  projectId: string | null;
  reservationId: string | null;
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
  reservationId: string | null;
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

  return markJobSucceeded(job, result, asset.id);
}

async function executeUpscale(job: {
  id: string;
  userId: string;
  projectId: string | null;
  reservationId: string | null;
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

  return markJobSucceeded(job, result, asset.id);
}

async function executeEdit(job: {
  id: string;
  userId: string;
  projectId: string | null;
  reservationId: string | null;
  providerId: string;
  modelId: string;
  inputJson: unknown;
  attemptCount: number;
}) {
  const env = getEnv();
  const prompt = readPrompt(job.inputJson);
  const loaded = await loadOwnedImage(job.userId, job.projectId, readAssetId(job.inputJson));
  const maskAssetId = readOptionalMaskAssetId(job.inputJson);
  const mask = maskAssetId
    ? await loadOwnedMask(job.userId, job.projectId, maskAssetId, loaded.source.width, loaded.source.height)
    : null;

  const provider = resolveProvider("EDIT", { providerId: job.providerId, modelId: job.modelId });
  const result = await runEdit(
    { prompt, image: loaded.bytes, mimeType: loaded.mime, mask: mask?.bytes },
    AbortSignal.timeout(getProviderTimeoutMs(provider.providerId)),
    { providerId: provider.providerId, modelId: provider.modelId },
  );
  return persistStudioDerivative(job, loaded.source, result, env, editedFilename(loaded.source.originalFilename));
}

async function executeRemoveObject(job: {
  id: string;
  userId: string;
  projectId: string | null;
  reservationId: string | null;
  providerId: string;
  modelId: string;
  inputJson: unknown;
  attemptCount: number;
}) {
  const env = getEnv();
  const loaded = await loadOwnedImage(job.userId, job.projectId, readAssetId(job.inputJson));
  const maskAssetId = readMaskAssetId(job.inputJson);
  const mask = await loadOwnedMask(
    job.userId,
    job.projectId,
    maskAssetId,
    loaded.source.width,
    loaded.source.height,
  );
  await assertMaskHasSelection(mask.bytes);

  const provider = resolveProvider("REMOVE_OBJECT", { providerId: job.providerId, modelId: job.modelId });
  const result = await runRemoveObject(
    { image: loaded.bytes, mimeType: loaded.mime, mask: mask.bytes },
    AbortSignal.timeout(getProviderTimeoutMs(provider.providerId)),
    { providerId: provider.providerId, modelId: provider.modelId },
  );
  return persistStudioDerivative(
    job,
    loaded.source,
    result,
    env,
    removedObjectFilename(loaded.source.originalFilename),
  );
}

async function executeImageToImage(job: {
  id: string;
  userId: string;
  projectId: string | null;
  reservationId: string | null;
  providerId: string;
  modelId: string;
  inputJson: unknown;
  attemptCount: number;
}) {
  const env = getEnv();
  const prompt = readPrompt(job.inputJson);
  const loaded = await loadOwnedImage(job.userId, job.projectId, readAssetId(job.inputJson));
  const strength = readOptionalStrength(job.inputJson);
  const provider = resolveProvider("IMAGE_TO_IMAGE", { providerId: job.providerId, modelId: job.modelId });
  const result = await runImageToImage(
    { prompt, image: loaded.bytes, mimeType: loaded.mime, strength },
    AbortSignal.timeout(getProviderTimeoutMs(provider.providerId)),
    { providerId: provider.providerId, modelId: provider.modelId },
  );
  return persistStudioDerivative(
    job,
    loaded.source,
    result,
    env,
    imageToImageFilename(loaded.source.originalFilename),
  );
}

async function persistStudioDerivative(
  job: { id: string; userId: string; projectId: string | null; reservationId: string | null; attemptCount: number },
  source: { id: string; originalFilename: string },
  result: ProviderResult,
  env: { MAX_UPLOAD_BYTES: number; MAX_IMAGE_PIXELS: number; MAX_IMAGE_EDGE_PX: number },
  originalFilename: string,
) {
  const image = requireProviderImage(result);
  const limits = {
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    maxImagePixels: env.MAX_IMAGE_PIXELS,
    maxImageEdgePx: env.MAX_IMAGE_EDGE_PX,
  };
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
    originalFilename: filenameForMime(originalFilename, sanitized.mimeType),
    sourceAssetId: source.id,
    sourceJobId: job.id,
  });

  return markJobSucceeded(job, result, asset.id);
}

async function loadOwnedImage(userId: string, projectId: string | null, assetId: string) {
  const env = getEnv();
  const source = await getOwnedAsset(userId, assetId);
  if (projectId && source.projectId !== projectId) {
    throw new DomainError("NOT_FOUND", "Asset not found", 404);
  }
  assertOwnedStorageKey(userId, source.storageKey);
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
  return { source, bytes: stored.body, mime: detected };
}

async function loadOwnedMask(
  userId: string,
  projectId: string | null,
  maskAssetId: string,
  sourceWidth: number,
  sourceHeight: number,
) {
  const env = getEnv();
  const mask = await getOwnedAsset(userId, maskAssetId);
  if (projectId && mask.projectId !== projectId) {
    throw new DomainError("NOT_FOUND", "Asset not found", 404);
  }
  assertOwnedStorageKey(userId, mask.storageKey);
  const stored = await getStorage().getObject(mask.storageKey);
  if (!stored) {
    throw new DomainError("ASSET_BYTES_MISSING", "The mask file is no longer in storage", 404);
  }
  if (stored.body.byteLength > env.MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The mask file exceeds the size limit");
  }
  await assertCompatibleMask(stored.body, sourceWidth, sourceHeight);
  return { source: mask, bytes: stored.body };
}

async function markJobSucceeded(
  job: { id: string; userId: string; reservationId: string | null; attemptCount: number },
  result: ProviderResult,
  outputAssetId: string,
  extraPayload: Record<string, unknown> = {},
) {
  return prisma.$transaction(async (tx) => {
    const succeeded = await tx.aIJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        outputAssetIds: [outputAssetId],
        errorCode: null,
        errorMessage: null,
      },
    });
    await tx.aIJobEvent.create({
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
          ...extraPayload,
        },
      },
    });
    await settleCredits(
      { userId: job.userId, jobId: job.id, reservationId: job.reservationId },
      tx,
    );
    return succeeded;
  });
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

function editedFilename(originalFilename: string) {
  return originalFilename.replace(/\.(jpe?g|png|webp)$/i, "") + "-edit.png";
}

function removedObjectFilename(originalFilename: string) {
  return originalFilename.replace(/\.(jpe?g|png|webp)$/i, "") + "-removed.png";
}

function imageToImageFilename(originalFilename: string) {
  return originalFilename.replace(/\.(jpe?g|png|webp)$/i, "") + "-i2i.png";
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

function readMaskAssetId(inputJson: unknown) {
  const maskAssetId = readOptionalMaskAssetId(inputJson);
  if (!maskAssetId) {
    throw new DomainError("MASK_REQUIRED", "Object removal requires a PNG mask of the same size as the source");
  }
  return maskAssetId;
}

function readOptionalMaskAssetId(inputJson: unknown) {
  if (typeof inputJson !== "object" || inputJson === null || !("maskAssetId" in inputJson)) {
    return null;
  }
  const maskAssetId = (inputJson as { maskAssetId: unknown }).maskAssetId;
  if (maskAssetId === undefined || maskAssetId === null) {
    return null;
  }
  if (typeof maskAssetId !== "string" || maskAssetId.length < 8) {
    throw new DomainError("VALIDATION", "Job is missing a mask");
  }
  return maskAssetId;
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

function readOptionalStrength(inputJson: unknown) {
  if (typeof inputJson !== "object" || inputJson === null || !("strength" in inputJson)) {
    return undefined;
  }
  const strength = (inputJson as { strength: unknown }).strength;
  if (strength === undefined || strength === null) {
    return undefined;
  }
  if (typeof strength !== "number" || !Number.isFinite(strength) || strength < 0.01 || strength > 1) {
    throw new DomainError("VALIDATION", "strength must be between 0.01 and 1");
  }
  return strength;
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
