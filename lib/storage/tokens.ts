import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";

export type StorageTokenPayload = {
  op: "put" | "get";
  key: string;
  exp: number;
  contentType: string;
  userId: string;
};

export function signStorageToken(payload: StorageTokenPayload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", getEnv().BETTER_AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyStorageToken(token: string, op: StorageTokenPayload["op"]): StorageTokenPayload {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    throw new DomainError("INVALID_STORAGE_TOKEN", "Download or upload link is invalid", 403);
  }
  const expected = createHmac("sha256", getEnv().BETTER_AUTH_SECRET).update(body).digest("base64url");
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new DomainError("INVALID_STORAGE_TOKEN", "Download or upload link is invalid", 403);
  }

  let payload: StorageTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StorageTokenPayload;
  } catch {
    throw new DomainError("INVALID_STORAGE_TOKEN", "Download or upload link is invalid", 403);
  }

  if (payload.op !== op || !payload.key || !payload.userId) {
    throw new DomainError("INVALID_STORAGE_TOKEN", "Download or upload link is invalid", 403);
  }
  if (payload.exp < Date.now()) {
    throw new DomainError("STORAGE_TOKEN_EXPIRED", "Download or upload link has expired", 403);
  }
  return payload;
}

export function localObjectUrl(token: string) {
  return `/api/storage/objects?token=${encodeURIComponent(token)}`;
}
