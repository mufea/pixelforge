import { auth } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session-guard";

export async function requireUserFromRequest(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return requireUser(session);
}
