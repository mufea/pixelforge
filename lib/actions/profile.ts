"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { profileSchema } from "@/lib/validators/profile";

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function updateProfile(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid profile" };
    }

    await prisma.userProfile.upsert({
      where: { userId: session.user.id },
      update: {
        displayName: parsed.data.displayName,
        locale: parsed.data.locale,
        timezone: parsed.data.timezone || null,
      },
      create: {
        userId: session.user.id,
        displayName: parsed.data.displayName,
        locale: parsed.data.locale,
        timezone: parsed.data.timezone || null,
      },
    });

    await prisma.user.update({
      where: { id: session.user.id },
      data: { name: parsed.data.displayName },
    });

    revalidatePath("/app/settings");
    revalidatePath("/app");
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not save profile" };
  }
}
