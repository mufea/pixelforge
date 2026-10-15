import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv, isS3Configured } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import type { ObjectStorage, StoredObject } from "@/lib/storage/types";

export class S3Storage implements ObjectStorage {
  readonly driver = "s3" as const;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putObject(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObject(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      if (!result.Body) {
        return null;
      }
      const bytes = await result.Body.transformToByteArray();
      const body = Buffer.from(bytes);
      return {
        body,
        contentType: result.ContentType ?? "application/octet-stream",
        contentLength: result.ContentLength ?? body.byteLength,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async deleteObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async presignPut(key: string, contentType: string, expiresSeconds: number) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: expiresSeconds },
    );
  }

  async presignGet(key: string, expiresSeconds: number) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: expiresSeconds },
    );
  }
}

export class UnconfiguredStorage implements ObjectStorage {
  readonly driver = "unconfigured" as const;

  async putObject(): Promise<void> {
    this.fail();
  }
  async getObject(): Promise<StoredObject | null> {
    this.fail();
  }
  async deleteObject(): Promise<void> {
    this.fail();
  }
  async presignPut(): Promise<string> {
    this.fail();
  }
  async presignGet(): Promise<string> {
    this.fail();
  }

  private fail(): never {
    throw new DomainError(
      "STORAGE_NOT_CONFIGURED",
      "Private object storage is not configured",
      503,
    );
  }
}

export function createS3Storage() {
  const env = getEnv();
  if (!isS3Configured(env)) {
    return new UnconfiguredStorage();
  }
  return new S3Storage(
    new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
    }),
    env.S3_BUCKET!,
  );
}

function isNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "NoSuchKey" || error.name === "NotFound")
  );
}
