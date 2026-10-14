import {
  AdminForbiddenError,
  UnauthenticatedError,
  isAdminRole,
} from "@/lib/auth/roles";

export type SessionLike = {
  user: {
    id: string;
    role: string;
  };
} | null;

export function requireUser<T extends SessionLike>(session: T) {
  if (!session?.user) {
    throw new UnauthenticatedError();
  }
  return session;
}

export function requireAdmin<T extends SessionLike>(session: T) {
  const authed = requireUser(session);
  if (!isAdminRole(authed.user.role)) {
    throw new AdminForbiddenError();
  }
  return authed;
}
