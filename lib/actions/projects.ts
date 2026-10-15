"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors";
import { UnauthenticatedError } from "@/lib/auth/roles";
import { createProject, softDeleteProject, updateProject } from "@/lib/projects/service";

export type ActionResult = { ok: true; id?: string } | { ok: false; message: string };

function toResult(error: unknown): ActionResult {
  if (error instanceof UnauthenticatedError) {
    return { ok: false, message: "Sign in required" };
  }
  if (error instanceof DomainError) {
    return { ok: false, message: error.message };
  }
  return { ok: false, message: "Could not save project" };
}

export async function createProjectAction(input: unknown): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const project = await createProject(session.user.id, input);
    revalidatePath("/app");
    revalidatePath("/app/projects");
    return { ok: true, id: project.id };
  } catch (error) {
    return toResult(error);
  }
}

export async function updateProjectAction(projectId: string, input: unknown): Promise<ActionResult> {
  try {
    const session = await requireUser();
    await updateProject(session.user.id, projectId, input);
    revalidatePath("/app/projects");
    revalidatePath(`/app/projects/${projectId}`);
    return { ok: true, id: projectId };
  } catch (error) {
    return toResult(error);
  }
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  try {
    const session = await requireUser();
    await softDeleteProject(session.user.id, projectId);
    revalidatePath("/app");
    revalidatePath("/app/projects");
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}
