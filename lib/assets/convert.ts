import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { filenameForMime, isAllowedImageMime } from "@/lib/assets/mime";
import { persistDerivedAsset, rollbackDerivedAsset } from "@/lib/assets/persist";
import { assertWithinQuota } from "@/lib/assets/quota";
import { getOwnedAsset } from "@/lib/assets/service";
import { convertImageBytes } from "@/lib/images/convert";
import {
  assertResizeWithinLimits,
  plannedOutputSize,
  type ImageTransform,
} from "@/lib/images/transform";
import { getOwnedProject } from "@/lib/projects/service";
import { getStorage } from "@/lib/storage";
import { assertOwnedStorageKey } from "@/lib/storage/keys";
import { batchConvertSchema, convertAssetSchema, MAX_BATCH_ASSETS } from "@/lib/validators/convert";

function parseConvertInput(input: unknown) {
  const parsed = convertAssetSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "outputFormat") {
      throw new DomainError("UNSUPPORTED_OUTPUT_FORMAT", "Output must be JPEG, PNG, or WebP");
    }
    throw new DomainError("VALIDATION", issue?.message ?? "Invalid conversion request");
  }
  if (!isAllowedImageMime(parsed.data.outputFormat)) {
    throw new DomainError("UNSUPPORTED_OUTPUT_FORMAT", "Output must be JPEG, PNG, or WebP");
  }
  return parsed.data;
}

function publicAsset(asset: {
  id: string;
  byteSize: number;
  mimeType: string;
  width: number;
  height: number;
  originalFilename: string;
  kind: string;
}) {
  return {
    id: asset.id,
    byteSize: asset.byteSize,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    originalFilename: asset.originalFilename,
    kind: asset.kind,
  };
}

async function convertOneOwnedAsset(
  userId: string,
  assetId: string,
  params: {
    outputFormat: "image/jpeg" | "image/png" | "image/webp";
    quality?: number;
    width?: number;
    height?: number;
    crop?: ImageTransform["crop"];
  },
) {
  const source = await getOwnedAsset(userId, assetId);
  assertOwnedStorageKey(userId, source.storageKey);
  const stored = await getStorage().getObject(source.storageKey);
  if (!stored) {
    throw new DomainError("ASSET_BYTES_MISSING", "The original file is no longer in storage", 404);
  }

  const env = getEnv();
  const limits = {
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    maxImagePixels: env.MAX_IMAGE_PIXELS,
    maxImageEdgePx: env.MAX_IMAGE_EDGE_PX,
  };
  const converted = await convertImageBytes(stored.body, params.outputFormat, limits, {
    quality: params.quality ?? 80,
    width: params.width,
    height: params.height,
    crop: params.crop,
  });

  await assertWithinQuota(userId, converted.outputByteSize);

  const output = await persistDerivedAsset({
    userId,
    projectId: source.projectId,
    kind: "DERIVATIVE",
    mimeType: converted.mimeType,
    bytes: converted.bytes,
    width: converted.width,
    height: converted.height,
    originalFilename: filenameForMime(source.originalFilename, converted.mimeType),
    sourceAssetId: source.id,
  });

  const originalStillThere = await getOwnedAsset(userId, source.id);
  return {
    original: {
      id: originalStillThere.id,
      byteSize: originalStillThere.byteSize,
      mimeType: originalStillThere.mimeType,
    },
    output: publicAsset(output),
    persisted: { id: output.id, storageKey: output.storageKey, byteSize: output.byteSize },
  };
}

export async function convertOwnedAsset(userId: string, assetId: string, input: unknown) {
  const parsed = parseConvertInput(input);
  const result = await convertOneOwnedAsset(userId, assetId, parsed);
  return { original: result.original, output: result.output };
}

export async function convertOwnedAssetBatch(userId: string, projectId: string, input: unknown) {
  const parsed = batchConvertSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "outputFormat") {
      throw new DomainError("UNSUPPORTED_OUTPUT_FORMAT", "Output must be JPEG, PNG, or WebP");
    }
    if (issue?.path[0] === "assetIds" && issue.code === "too_big") {
      throw new DomainError("BATCH_TOO_LARGE", `A batch can include at most ${MAX_BATCH_ASSETS} images`);
    }
    throw new DomainError("VALIDATION", issue?.message ?? "Invalid batch conversion request");
  }

  const uniqueIds = new Set(parsed.data.assetIds);
  if (uniqueIds.size !== parsed.data.assetIds.length) {
    throw new DomainError("VALIDATION", "Batch asset IDs must be unique");
  }

  await getOwnedProject(userId, projectId);

  const env = getEnv();
  const limits = {
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    maxImagePixels: env.MAX_IMAGE_PIXELS,
    maxImageEdgePx: env.MAX_IMAGE_EDGE_PX,
  };

  const sources = [];
  for (const assetId of parsed.data.assetIds) {
    const source = await getOwnedAsset(userId, assetId);
    if (source.projectId !== projectId) {
      throw new DomainError("NOT_FOUND", "Asset not found", 404);
    }
    const planned = plannedOutputSize(source.width, source.height, parsed.data);
    assertResizeWithinLimits(planned.width, planned.height, limits);
    sources.push(source);
  }

  const reservedBytes = sources.reduce((sum, source) => sum + source.byteSize, 0);
  await assertWithinQuota(userId, reservedBytes);

  const created: Array<{ id: string; storageKey: string; byteSize: number }> = [];
  try {
    const results = [];
    for (const source of sources) {
      const result = await convertOneOwnedAsset(userId, source.id, parsed.data);
      created.push(result.persisted);
      results.push({ original: result.original, output: result.output });
    }
    return { results };
  } catch (error) {
    for (const asset of created.reverse()) {
      await rollbackDerivedAsset(userId, asset);
    }
    throw error;
  }
}
