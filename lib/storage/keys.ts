const USER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function uploadObjectKey(userId: string, intentId: string) {
  assertSafeId(userId, "user id");
  assertSafeId(intentId, "intent id");
  return `users/${userId}/uploads/${intentId}`;
}

export function assetObjectKey(userId: string, assetId: string, version: number) {
  assertSafeId(userId, "user id");
  assertSafeId(assetId, "asset id");
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Invalid asset version");
  }
  return `users/${userId}/assets/${assetId}/v${version}`;
}

export function assertOwnedStorageKey(userId: string, storageKey: string) {
  const prefix = `users/${userId}/`;
  if (!storageKey.startsWith(prefix)) {
    throw new Error("Storage key is outside the owner prefix");
  }
  if (storageKey.includes("..") || storageKey.includes("\\")) {
    throw new Error("Storage key is invalid");
  }
}

export function containsOriginalFilename(storageKey: string, originalFilename: string) {
  const base = originalFilename.replaceAll("\\", "/").split("/").pop()?.trim() ?? "";
  if (!base) {
    return false;
  }
  const objectName = storageKey.split("/").pop()?.toLowerCase() ?? "";
  const fileName = base.toLowerCase();
  return objectName === fileName || objectName.startsWith(`${fileName}.`);
}

function assertSafeId(value: string, label: string) {
  if (!USER_ID_PATTERN.test(value) || !OBJECT_ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}
