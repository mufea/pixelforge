import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { localObjectUrl, signStorageToken } from "@/lib/storage/tokens";
import type { ObjectStorage, StoredObject } from "@/lib/storage/types";

export class LocalDiskStorage implements ObjectStorage {
  readonly driver = "local" as const;

  constructor(private readonly rootDir: string) {}

  async putObject(key: string, body: Buffer, contentType: string) {
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    await writeFile(`${filePath}.meta`, JSON.stringify({ contentType, contentLength: body.byteLength }));
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const filePath = this.resolve(key);
    try {
      const body = await readFile(filePath);
      const metaRaw = await readFile(`${filePath}.meta`, "utf8");
      const meta = JSON.parse(metaRaw) as { contentType: string; contentLength: number };
      return { body, contentType: meta.contentType, contentLength: body.byteLength };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string) {
    const filePath = this.resolve(key);
    await unlink(filePath).catch(() => undefined);
    await unlink(`${filePath}.meta`).catch(() => undefined);
  }

  async presignPut(key: string, contentType: string, expiresSeconds: number) {
    return this.sign("put", key, contentType, expiresSeconds);
  }

  async presignGet(key: string, expiresSeconds: number) {
    const stored = await this.getObject(key);
    if (!stored) {
      throw new DomainError("NOT_FOUND", "Object is missing", 404);
    }
    return this.sign("get", key, stored.contentType, expiresSeconds);
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

  private resolve(key: string) {
    if (key.includes("..") || key.includes("\\") || path.isAbsolute(key)) {
      throw new DomainError("INVALID_STORAGE_KEY", "Storage key is invalid", 400);
    }
    const resolved = path.resolve(this.rootDir, key);
    const root = path.resolve(this.rootDir);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw new DomainError("INVALID_STORAGE_KEY", "Storage key is invalid", 400);
    }
    return resolved;
  }
}

export function createLocalDiskStorage() {
  return new LocalDiskStorage(getEnv().STORAGE_LOCAL_DIR);
}
