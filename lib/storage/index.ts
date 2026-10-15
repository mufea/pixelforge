import { getEnv, isS3Configured } from "@/lib/env";
import { createLocalDiskStorage } from "@/lib/storage/local";
import { getMemoryStorage } from "@/lib/storage/memory";
import { createS3Storage } from "@/lib/storage/s3";
import type { ObjectStorage } from "@/lib/storage/types";

let override: ObjectStorage | null = null;
let cached: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (override) {
    return override;
  }
  if (cached) {
    return cached;
  }
  cached = createStorage();
  return cached;
}

export function setStorageForTests(storage: ObjectStorage | null) {
  override = storage;
  cached = null;
}

export function resetStorageCache() {
  cached = null;
}

function createStorage(): ObjectStorage {
  const env = getEnv();
  if (isS3Configured(env)) {
    return createS3Storage();
  }
  if (env.NODE_ENV === "test") {
    return getMemoryStorage();
  }
  if (env.NODE_ENV === "production") {
    return createS3Storage();
  }
  return createLocalDiskStorage();
}
