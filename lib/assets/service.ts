import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { DomainError, notFound } from "@/lib/errors";
import { displayFilename, extensionMatchesMime, isAllowedImageMime } from "@/lib/assets/mime";
import { assertWithinQuota } from "@/lib/assets/quota";
import { validateAndSanitizeImage } from "@/lib/assets/validate-image";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { assetObjectKey, assertOwnedStorageKey, containsOriginalFilename, uploadObjectKey } from "@/lib/storage/keys";
import { getOwnedProject } from "@/lib/projects/service";
import { uploadIntentSchema } from "@/lib/validators/upload";

export async function createUploadIntent(userId: string, input: unknown) {
  const env = getEnv();
  const allowed = consumeRateLimit(`upload-intent:${userId}`, env.UPLOAD_INTENT_RATE_LIMIT_PER_MINUTE);
  if (allowed === false) {
    throw new DomainError("RATE_LIMITED", "Too many upload requests. Try again in a minute.", 429);
  }

  const parsed = uploadIntentSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid upload");
  }
  if (!isAllowedImageMime(parsed.data.mimeType)) {
    throw new DomainError("VALIDATION_INVALID_MIME", "Only JPEG, PNG, and WebP uploads are allowed");
  }
  if (!extensionMatchesMime(parsed.data.filename, parsed.data.mimeType)) {
    throw new DomainError("VALIDATION_INVALID_MIME", "File extension does not match the declared type");
  }
  if (parsed.data.byteSize > env.MAX_UPLOAD_BYTES) {
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The declared file size exceeds the upload limit");
  }

  if (parsed.data.projectId) {
    await getOwnedProject(userId, parsed.data.projectId);
  }

  await assertWithinQuota(userId, parsed.data.byteSize);

  const intentId = crypto.randomUUID();
  const storageKey = uploadObjectKey(userId, intentId);
  if (containsOriginalFilename(storageKey, parsed.data.filename)) {
    throw new DomainError("INTERNAL", "Refusing to store a user filename in the object key", 500);
  }

  const intent = await prisma.uploadIntent.create({
    data: {
      id: intentId,
      userId,
      projectId: parsed.data.projectId,
      storageKey,
      declaredMime: parsed.data.mimeType,
      declaredBytes: parsed.data.byteSize,
      originalFilename: displayFilename(parsed.data.filename),
      status: "pending",
      expiresAt: new Date(Date.now() + env.S3_PRESIGN_UPLOAD_TTL_SECONDS * 1000),
    },
  });

  const uploadUrl = await getStorage().presignPut(
    storageKey,
    parsed.data.mimeType,
    env.S3_PRESIGN_UPLOAD_TTL_SECONDS,
  );

  return {
    intentId: intent.id,
    uploadUrl,
    expiresAt: intent.expiresAt.toISOString(),
    maxBytes: env.MAX_UPLOAD_BYTES,
  };
}

export async function completeUpload(userId: string, intentId: string) {
  const env = getEnv();
  const intent = await prisma.uploadIntent.findFirst({
    where: { id: intentId, userId },
  });
  if (!intent) {
    notFound("Upload not found");
  }
  if (intent.status === "completed" && intent.assetId) {
    const existing = await getOwnedAsset(userId, intent.assetId);
    return existing;
  }
  if (intent.status !== "pending") {
    throw new DomainError("UPLOAD_NOT_PENDING", "This upload can no longer be completed");
  }
  if (intent.expiresAt.getTime() < Date.now()) {
    await rejectIntent(intent.id, intent.storageKey, "UPLOAD_EXPIRED");
    throw new DomainError("UPLOAD_EXPIRED", "The upload slot expired");
  }
  if (intent.projectId) {
    try {
      await getOwnedProject(userId, intent.projectId);
    } catch (error) {
      await rejectIntent(intent.id, intent.storageKey, "NOT_FOUND");
      throw error;
    }
  }

  assertOwnedStorageKey(userId, intent.storageKey);
  const stored = await getStorage().getObject(intent.storageKey);
  if (!stored) {
    throw new DomainError("UPLOAD_INCOMPLETE", "No file was received for this upload");
  }

  if (stored.body.byteLength > intent.declaredBytes) {
    await rejectIntent(intent.id, intent.storageKey, "VALIDATION_FILE_TOO_LARGE");
    throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The uploaded file is larger than declared");
  }

  let sanitized;
  try {
    if (!isAllowedImageMime(intent.declaredMime)) {
      throw new DomainError("VALIDATION_INVALID_MIME", "Only JPEG, PNG, and WebP uploads are allowed");
    }
    sanitized = await validateAndSanitizeImage(stored.body, intent.declaredMime, {
      maxUploadBytes: env.MAX_UPLOAD_BYTES,
      maxImagePixels: env.MAX_IMAGE_PIXELS,
      maxImageEdgePx: env.MAX_IMAGE_EDGE_PX,
    });
  } catch (error) {
    const code = error instanceof DomainError ? error.code : "VALIDATION_INVALID_SIGNATURE";
    await rejectIntent(intent.id, intent.storageKey, code);
    throw error;
  }

  const assetId = crypto.randomUUID();
  const finalKey = assetObjectKey(userId, assetId, 1);
  if (containsOriginalFilename(finalKey, intent.originalFilename)) {
    await rejectIntent(intent.id, intent.storageKey, "INTERNAL");
    throw new DomainError("INTERNAL", "Refusing to store a user filename in the object key", 500);
  }

  await getStorage().putObject(finalKey, sanitized.bytes, sanitized.mimeType);

  try {
    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          id: assetId,
          userId,
          projectId: intent.projectId,
          kind: "ORIGINAL",
          mimeType: sanitized.mimeType,
          byteSize: sanitized.bytes.byteLength,
          width: sanitized.width,
          height: sanitized.height,
          checksumSha256: sanitized.checksumSha256,
          storageKey: finalKey,
          originalFilename: intent.originalFilename,
        },
      });
      await tx.assetVersion.create({
        data: {
          assetId: created.id,
          userId,
          version: 1,
          mimeType: sanitized.mimeType,
          byteSize: sanitized.bytes.byteLength,
          width: sanitized.width,
          height: sanitized.height,
          storageKey: finalKey,
        },
      });
      await tx.userProfile.upsert({
        where: { userId },
        update: { storageUsedBytes: { increment: sanitized.bytes.byteLength } },
        create: { userId, storageUsedBytes: sanitized.bytes.byteLength },
      });
      await tx.uploadIntent.update({
        where: { id: intent.id },
        data: { status: "completed", assetId: created.id, errorCode: null },
      });
      return created;
    });
    await getStorage().deleteObject(intent.storageKey);
    return asset;
  } catch (error) {
    await getStorage().deleteObject(finalKey);
    throw error;
  }
}

export async function getOwnedAsset(userId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, userId, deletedAt: null },
  });
  if (!asset) {
    notFound("Asset not found");
  }
  return asset;
}

export async function listProjectAssets(userId: string, projectId: string) {
  await getOwnedProject(userId, projectId);
  return prisma.asset.findMany({
    where: { userId, projectId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function createDownloadUrl(userId: string, assetId: string) {
  const asset = await getOwnedAsset(userId, assetId);
  assertOwnedStorageKey(userId, asset.storageKey);
  const env = getEnv();
  const url = await getStorage().presignGet(asset.storageKey, env.S3_PRESIGN_DOWNLOAD_TTL_SECONDS);
  return {
    url,
    expiresInSeconds: env.S3_PRESIGN_DOWNLOAD_TTL_SECONDS,
    mimeType: asset.mimeType,
    filename: asset.originalFilename,
  };
}

export async function softDeleteAsset(userId: string, assetId: string) {
  const asset = await getOwnedAsset(userId, assetId);
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({
      where: { id: asset.id },
      data: { deletedAt: new Date() },
    });
    await tx.userProfile.updateMany({
      where: { userId, storageUsedBytes: { gte: asset.byteSize } },
      data: { storageUsedBytes: { decrement: asset.byteSize } },
    });
  });
  await getStorage().deleteObject(asset.storageKey);
  return { ok: true as const };
}

async function rejectIntent(intentId: string, storageKey: string, errorCode: string) {
  await prisma.uploadIntent.update({
    where: { id: intentId },
    data: { status: "rejected", errorCode },
  });
  await getStorage().deleteObject(storageKey);
}
