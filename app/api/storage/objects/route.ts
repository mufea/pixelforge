import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { jsonError } from "@/lib/http/responses";
import { getStorage } from "@/lib/storage";
import { assertOwnedStorageKey } from "@/lib/storage/keys";
import { verifyStorageToken } from "@/lib/storage/tokens";

export async function PUT(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
      throw new DomainError("INVALID_STORAGE_TOKEN", "Download or upload link is invalid", 403);
    }
    const payload = verifyStorageToken(token, "put");
    assertOwnedStorageKey(payload.userId, payload.key);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.split(";")[0]?.trim() !== payload.contentType) {
      throw new DomainError("VALIDATION_INVALID_MIME", "Content type does not match the upload slot");
    }
    const buffer = Buffer.from(await request.arrayBuffer());
    if (buffer.byteLength > getEnv().MAX_UPLOAD_BYTES) {
      throw new DomainError("VALIDATION_FILE_TOO_LARGE", "The uploaded file exceeds the size limit");
    }
    await getStorage().putObject(payload.key, buffer, payload.contentType);
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
      throw new DomainError("INVALID_STORAGE_TOKEN", "Download or upload link is invalid", 403);
    }
    const payload = verifyStorageToken(token, "get");
    assertOwnedStorageKey(payload.userId, payload.key);
    const stored = await getStorage().getObject(payload.key);
    if (!stored) {
      throw new DomainError("NOT_FOUND", "Object is missing", 404);
    }
    return new Response(new Uint8Array(stored.body), {
      status: 200,
      headers: {
        "Content-Type": stored.contentType,
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
