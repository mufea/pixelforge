"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { UnauthenticatedError } from "@/lib/auth/roles";
import { DomainError } from "@/lib/errors";
import { softDeleteAsset } from "@/lib/assets/service";

export type AssetActionResult = { ok: true } | { ok: false; message: string };

export async function deleteAssetAction(assetId: string, projectId?: string): Promise<AssetActionResult> {
  try {
    const session = await requireUser();
    await softDeleteAsset(session.user.id, assetId);
    revalidatePath("/app/projects");
    if (projectId) {
      revalidatePath(`/app/projects/${projectId}`);
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, message: "Sign in required" };
    }
    if (error instanceof DomainError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Could not delete the image" };
  }
}
