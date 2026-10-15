export type StoredObject = {
  body: Buffer;
  contentType: string;
  contentLength: number;
};

export type ObjectStorage = {
  driver: "s3" | "local" | "memory" | "unconfigured";
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<StoredObject | null>;
  deleteObject(key: string): Promise<void>;
  presignPut(key: string, contentType: string, expiresSeconds: number): Promise<string>;
  presignGet(key: string, expiresSeconds: number): Promise<string>;
};
