import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AllowedImageMime } from "@/lib/assets/mime";
import { getStorage } from "@/lib/storage";
import { assetObjectKey, containsOriginalFilename } from "@/lib/storage/keys";
import { DomainError } from "@/lib/errors";

export async function persistDerivedAsset(input: {
  userId: string;
  projectId: string | null;
  kind: "DERIVATIVE" | "GENERATED";
  mimeType: AllowedImageMime;
  bytes: Buffer;
  width: number;
  height: number;
  originalFilename: string;
  sourceAssetId?: string;
  sourceJobId?: string;
}) {
  const assetId = crypto.randomUUID();
  const storageKey = assetObjectKey(input.userId, assetId, 1);
  if (containsOriginalFilename(storageKey, input.originalFilename)) {
    throw new DomainError("INTERNAL", "Refusing to store a user filename in the object key", 500);
  }

  try {
    await getStorage().putObject(storageKey, input.bytes, input.mimeType);
  } catch (error) {
    throw asStorageUnavailable(error);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          id: assetId,
          userId: input.userId,
          projectId: input.projectId,
          kind: input.kind,
          mimeType: input.mimeType,
          byteSize: input.bytes.byteLength,
          width: input.width,
          height: input.height,
          checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
          storageKey,
          originalFilename: input.originalFilename,
          ...(input.sourceAssetId ? { sourceAssetId: input.sourceAssetId } : {}),
          ...(input.sourceJobId ? { sourceJobId: input.sourceJobId } : {}),
        },
      });
      await tx.assetVersion.create({
        data: {
          assetId: created.id,
          userId: input.userId,
          version: 1,
          mimeType: input.mimeType,
          byteSize: input.bytes.byteLength,
          width: input.width,
          height: input.height,
          storageKey,
        },
      });
      await tx.userProfile.upsert({
        where: { userId: input.userId },
        update: { storageUsedBytes: { increment: input.bytes.byteLength } },
        create: { userId: input.userId, storageUsedBytes: input.bytes.byteLength },
      });
      return created;
    });
  } catch (error) {
    await getStorage().deleteObject(storageKey);
    throw error;
  }
}

export async function rollbackDerivedAsset(userId: string, asset: { id: string; storageKey: string; byteSize: number }) {
  await prisma.$transaction(async (tx) => {
    await tx.asset.deleteMany({ where: { id: asset.id, userId } });
    await tx.userProfile.updateMany({
      where: { userId, storageUsedBytes: { gte: asset.byteSize } },
      data: { storageUsedBytes: { decrement: asset.byteSize } },
    });
  });
  await getStorage().deleteObject(asset.storageKey);
}

function asStorageUnavailable(error: unknown) {
  if (error instanceof DomainError) {
    return error;
  }
  return new DomainError(
    "STORAGE_UNAVAILABLE",
    "Private object storage did not accept the file",
    503,
  );
}
