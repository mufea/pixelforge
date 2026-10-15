import { prisma } from "@/lib/db";
import { DomainError, notFound } from "@/lib/errors";
import { projectSchema } from "@/lib/validators/project";

export async function createProject(userId: string, input: unknown) {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid project");
  }

  return prisma.project.create({
    data: {
      userId,
      name: parsed.data.name,
      description: parsed.data.description || null,
    },
  });
}

export async function listProjects(userId: string) {
  return prisma.project.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
  });
}

export async function getOwnedProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId, deletedAt: null },
  });
  if (!project) {
    notFound("Project not found");
  }
  return project;
}

export async function updateProject(userId: string, projectId: string, input: unknown) {
  await getOwnedProject(userId, projectId);
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.issues[0]?.message ?? "Invalid project");
  }
  return prisma.project.update({
    where: { id: projectId },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
    },
  });
}

export async function softDeleteProject(userId: string, projectId: string) {
  await getOwnedProject(userId, projectId);
  return prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
  });
}
