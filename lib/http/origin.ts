import { getEnv } from "@/lib/env";
import { DomainError } from "@/lib/errors";

export function assertSameOrigin(request: Request) {
  const allowed = new URL(getEnv().APP_URL).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin !== allowed) {
      throw new DomainError("ORIGIN_FORBIDDEN", "Request origin is not allowed", 403);
    }
    return;
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    throw new DomainError("ORIGIN_FORBIDDEN", "Request origin is not allowed", 403);
  }
  try {
    if (new URL(referer).origin !== allowed) {
      throw new DomainError("ORIGIN_FORBIDDEN", "Request origin is not allowed", 403);
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw new DomainError("ORIGIN_FORBIDDEN", "Request origin is not allowed", 403);
  }
}
