import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { filenameForMime, isAllowedImageMime } from "@/lib/assets/mime";
import { persistDerivedAsset } from "@/lib/assets/persist";
import { assertWithinQuota } from "@/lib/assets/quota";
import { getOwnedAsset } from "@/lib/assets/service";
import { convertImageBytes } from "@/lib/images/convert";
import { getStorage } from "@/lib/storage";
import { assertOwnedStorageKey } from "@/lib/storage/keys";
import { convertAssetSchema } from "@/lib/validators/convert";

export async function convertOwnedAsset(userId: string, assetId: string, input: unknown) {
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

  const source = await getOwnedAsset(userId, assetId);
  assertOwnedStorageKey(userId, source.storageKey);
  const stored = await getStorage().getObject(source.storageKey);
  if (!stored) {
    throw new DomainError("ASSET_BYTES_MISSING", "The original file is no longer in storage", 404);
  }

  const env = getEnv();
  const converted = await convertImageBytes(stored.body, parsed.data.outputFormat, {
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    maxImagePixels: env.MAX_IMAGE_PIXELS,
    maxImageEdgePx: env.MAX_IMAGE_EDGE_PX,
  }, parsed.data.quality ?? 80);

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
    output: {
      id: output.id,
      byteSize: output.byteSize,
      mimeType: output.mimeType,
      width: output.width,
      height: output.height,
      originalFilename: output.originalFilename,
      kind: output.kind,
    },
  };
}
