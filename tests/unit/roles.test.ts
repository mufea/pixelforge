import { describe, expect, it } from "vitest";
import { AdminForbiddenError, isAdminRole, isUserRole } from "@/lib/auth/roles";
import { requireAdmin, requireUser } from "@/lib/auth/session-guard";

describe("roles", () => {
  it("accepts only known roles", () => {
    expect(isUserRole("user")).toBe(true);
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("superadmin")).toBe(false);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("user")).toBe(false);
  });

  it("requireUser rejects missing sessions", () => {
    expect(() => requireUser(null)).toThrow(/Authentication required/);
  });

  it("requireAdmin rejects ordinary users", () => {
    const session = { user: { id: "u1", role: "user" } };
    expect(() => requireAdmin(session)).toThrow(AdminForbiddenError);
  });

  it("requireAdmin allows administrators", () => {
    const session = { user: { id: "u2", role: "admin" } };
    expect(requireAdmin(session).user.id).toBe("u2");
  });
});
