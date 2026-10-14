import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session-guard";
import { AdminForbiddenError } from "@/lib/auth/roles";

const password = "CorrectHorse!9";

describe("authentication", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  it("registers, signs in, and returns a session", async () => {
    const email = `phase1-${randomUUID()}@pixelforge.test`;
    const signedUp = await auth.api.signUpEmail({
      body: {
        name: "Phase One",
        email,
        password,
      },
    });
    expect(signedUp.user.email).toBe(email);
    expect(signedUp.user.role).toBe("user");
    createdUserIds.push(signedUp.user.id);

    const signInResponse = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    expect(signInResponse.ok).toBe(true);
    const setCookie = signInResponse.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/https:\/\//i);

    const signIn = await auth.api.signInEmail({
      body: { email, password },
    });
    expect(signIn.user.id).toBe(signedUp.user.id);

    const stored = await prisma.user.findUnique({ where: { email } });
    expect(stored?.email).toBe(email);
    expect(stored?.role).toBe("user");
  });

  it("ignores a client-supplied admin role on registration", async () => {
    const email = `phase1-role-${randomUUID()}@pixelforge.test`;
    const signedUp = await auth.api.signUpEmail({
      body: {
        name: "Role Probe",
        email,
        password,
        role: "admin",
      } as { name: string; email: string; password: string; role: string },
    });
    createdUserIds.push(signedUp.user.id);
    expect(signedUp.user.role).toBe("user");
    const stored = await prisma.user.findUnique({ where: { id: signedUp.user.id } });
    expect(stored?.role).toBe("user");
  });

  it("keeps admin routes forbidden for ordinary users", async () => {
    expect(() => requireAdmin({ user: { id: "u", role: "user" } })).toThrow(AdminForbiddenError);
  });
});
