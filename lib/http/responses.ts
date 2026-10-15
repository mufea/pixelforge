import { AdminForbiddenError, UnauthenticatedError } from "@/lib/auth/roles";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logging";

export function jsonError(error: unknown) {
  if (error instanceof UnauthenticatedError) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: error.message } }, { status: 401 });
  }
  if (error instanceof AdminForbiddenError) {
    return Response.json({ error: { code: "FORBIDDEN", message: error.message } }, { status: 403 });
  }
  if (error instanceof DomainError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }

  logger.error({ err: error }, "Unhandled API error");
  return Response.json(
    { error: { code: "INTERNAL", message: "Request failed" } },
    { status: 500 },
  );
}
