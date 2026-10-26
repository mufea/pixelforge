import { Readable } from "node:stream";
import { z } from "zod";
import { displayFilename } from "@/lib/assets/mime";
import { getOwnedAsset } from "@/lib/assets/service";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { ZipStoreWriter } from "@/lib/export/zip-archive";
import { getOwnedProject } from "@/lib/projects/service";
import { getStorage } from "@/lib/storage";
import { assertOwnedStorageKey } from "@/lib/storage/keys";

const PROCESSED_KINDS = ["DERIVATIVE", "GENERATED"] as const;
const exportBodySchema = z.object({
  assetIds: z.array(z.string().uuid()).max(200).optional(),
});

export type ProjectZipExport = {
  filename: string;
  stream: Readable;
  fileCount: number;
  byteSize: number;
};

export async function exportProjectProcessedAssets(
  userId: string,
  projectId: string,
  body: unknown,
): Promise<ProjectZipExport> {
  const env = getEnv();
  await getOwnedProject(userId, projectId);
  const parsed = exportBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid export request");
  }

  const assets = parsed.data.assetIds
    ? await loadExplicitAssets(userId, projectId, parsed.data.assetIds)
    : await prisma.asset.findMany({
        where: {
          userId,
          projectId,
          deletedAt: null,
          kind: { in: [...PROCESSED_KINDS] },
        },
        orderBy: { createdAt: "asc" },
        take: env.ZIP_EXPORT_MAX_FILES + 1,
      });

  if (assets.length === 0) {
    throw new DomainError("VALIDATION", "No processed assets are available to export");
  }
  if (assets.length > env.ZIP_EXPORT_MAX_FILES) {
    throw new DomainError(
      "ZIP_EXPORT_TOO_MANY_FILES",
      `Export is limited to ${env.ZIP_EXPORT_MAX_FILES} files`,
      413,
    );
  }

  const totalBytes = assets.reduce((sum, asset) => sum + asset.byteSize, 0);
  if (totalBytes > env.ZIP_EXPORT_MAX_BYTES) {
    throw new DomainError(
      "ZIP_EXPORT_TOO_LARGE",
      `Export is limited to ${env.ZIP_EXPORT_MAX_BYTES} bytes`,
      413,
    );
  }

  const zip = new ZipStoreWriter();
  const usedNames = new Set<string>();
  queueMicrotask(() => {
    writeArchive(zip, assets, usedNames).catch((error) => {
      zip.fail(error);
    });
  });

  return {
    filename: `pixelforge-${projectId.slice(0, 8)}.zip`,
    stream: zip.stream,
    fileCount: assets.length,
    byteSize: totalBytes,
  };
}

export function archiveEntryName(assetId: string, originalFilename: string, used: Set<string>) {
  const base = displayFilename(originalFilename)
    .replaceAll("..", "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  const safeBase = base.length > 0 ? base : "asset";
  const prefix = assetId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 8);
  let candidate = `${prefix}-${safeBase}`;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${prefix}-${n}-${safeBase}`;
    n += 1;
  }
  if (candidate.includes("/") || candidate.includes("\\") || candidate.includes("..")) {
    throw new DomainError("INTERNAL", "Refusing an unsafe archive entry name", 500);
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function loadExplicitAssets(userId: string, projectId: string, assetIds: string[]) {
  const uniqueIds = [...new Set(assetIds)];
  const env = getEnv();
  if (uniqueIds.length > env.ZIP_EXPORT_MAX_FILES) {
    throw new DomainError(
      "ZIP_EXPORT_TOO_MANY_FILES",
      `Export is limited to ${env.ZIP_EXPORT_MAX_FILES} files`,
      413,
    );
  }
  const assets = [];
  for (const assetId of uniqueIds) {
    const asset = await getOwnedAsset(userId, assetId);
    if (asset.projectId !== projectId) {
      throw new DomainError("NOT_FOUND", "Asset not found", 404);
    }
    if (!(PROCESSED_KINDS as readonly string[]).includes(asset.kind)) {
      throw new DomainError("VALIDATION", "Only processed assets can be exported");
    }
    assets.push(asset);
  }
  return assets;
}

async function writeArchive(
  zip: ZipStoreWriter,
  assets: Array<{ id: string; userId: string; storageKey: string; originalFilename: string; byteSize: number }>,
  usedNames: Set<string>,
) {
  const storage = getStorage();
  const env = getEnv();
  try {
    for (const asset of assets) {
      assertOwnedStorageKey(asset.userId, asset.storageKey);
      const stored = await storage.getObject(asset.storageKey);
      if (!stored) {
        throw new DomainError("ASSET_BYTES_MISSING", "A processed file is no longer in storage", 404);
      }
      if (stored.body.byteLength > env.ZIP_EXPORT_MAX_BYTES) {
        throw new DomainError("ZIP_EXPORT_TOO_LARGE", `Export is limited to ${env.ZIP_EXPORT_MAX_BYTES} bytes`, 413);
      }
      zip.addFile(archiveEntryName(asset.id, asset.originalFilename, usedNames), stored.body);
    }
    zip.finish();
  } catch (error) {
    zip.fail(error);
    throw error;
  }
}
