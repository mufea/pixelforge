import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";

export async function assertWithinQuota(userId: string, additionalBytes: number) {
  const env = getEnv();
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const used = profile?.storageUsedBytes ?? 0;
  const pending = await prisma.uploadIntent.aggregate({
    where: { userId, status: "pending", expiresAt: { gt: new Date() } },
    _sum: { declaredBytes: true },
  });
  const reserved = pending._sum.declaredBytes ?? 0;
  if (used + reserved + additionalBytes > env.STORAGE_QUOTA_BYTES) {
    throw new DomainError("QUOTA_EXCEEDED", "This upload would exceed your storage quota", 403);
  }
  return { used, reserved, quota: env.STORAGE_QUOTA_BYTES };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
