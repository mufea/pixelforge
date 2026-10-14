import "server-only";

import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { requireAdmin as assertAdmin, requireUser as assertUser } from "@/lib/auth/session-guard";

export async function getCurrentSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

export async function requireUser() {
  return assertUser(await getCurrentSession());
}

export async function requireAdmin() {
  return assertAdmin(await getCurrentSession());
}
