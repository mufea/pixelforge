import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { localObjectUrl, signStorageToken } from "@/lib/storage/tokens";
import type { ObjectStorage, StoredObject } from "@/lib/storage/types";

export class MemoryStorage implements ObjectStorage {
  readonly driver = "memory" as const;
  private readonly objects = new Map<string, StoredObject>();

  async putObject(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType, contentLength: body.byteLength });
  }

  async getObject(key: string) {
    const stored = this.objects.get(key);
    if (!stored) {
      return null;
    }
    return { ...stored, body: Buffer.from(stored.body) };
  }

  async deleteObject(key: string) {
    this.objects.delete(key);
  }

  async presignPut(key: string, contentType: string, expiresSeconds: number) {
    return this.sign("put", key, contentType, expiresSeconds);
  }

  async presignGet(key: string, expiresSeconds: number) {
    const stored = this.objects.get(key);
    if (!stored) {
      throw new DomainError("NOT_FOUND", "Object is missing", 404);
    }
    return this.sign("get", key, stored.contentType, expiresSeconds);
  }

  clear() {
    this.objects.clear();
  }

  has(key: string) {
    return this.objects.has(key);
  }

  private sign(op: "put" | "get", key: string, contentType: string, expiresSeconds: number) {
    const owner = key.split("/")[1];
    if (!owner) {
      throw new DomainError("INVALID_STORAGE_KEY", "Storage key is invalid", 400);
    }
    return localObjectUrl(
      signStorageToken({
        op,
        key,
        contentType,
        userId: owner,
        exp: Date.now() + expiresSeconds * 1000,
      }),
    );
  }
}

let memory: MemoryStorage | undefined;

export function getMemoryStorage() {
  const env = getEnv();
  if (!memory) {
    memory = new MemoryStorage();
  }
  if (env.NODE_ENV === "test") {
    return memory;
  }
  return memory;
}

export function resetMemoryStorage() {
  memory?.clear();
}
