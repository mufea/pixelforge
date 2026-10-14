export const USER_ROLES = ["user", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

export function isAdminRole(value: string | null | undefined): boolean {
  return value === "admin";
}

export class AdminForbiddenError extends Error {
  readonly status = 403;

  constructor(message = "Administrator access required") {
    super(message);
    this.name = "AdminForbiddenError";
  }
}

export class UnauthenticatedError extends Error {
  readonly status = 401;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}
