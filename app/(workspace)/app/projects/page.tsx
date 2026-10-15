import type { Metadata } from "next";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { formatBytes } from "@/lib/assets/quota";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import { listProjects } from "@/lib/projects/service";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const session = await requireUser();
  const [projects, profile] = await Promise.all([
    listProjects(session.user.id),
    prisma.userProfile.findUnique({ where: { userId: session.user.id } }),
  ]);
  const quota = getEnv().STORAGE_QUOTA_BYTES;
  const used = profile?.storageUsedBytes ?? 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-2 text-muted-foreground">
            Private libraries scoped to your account. Storage used {formatBytes(used)} of {formatBytes(quota)}.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/projects/new">New project</Link>
        </Button>
      </div>
      {projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="size-5" />
              No projects yet
            </CardTitle>
            <CardDescription>
              Create a project, then upload JPEG, PNG, or WebP files. Other users cannot see this library, even if they guess an id.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <Link key={project.id} href={`/app/projects/${project.id}`} className="block">
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>
                    {project.description || "No description"} · {project._count.assets}{" "}
                    {project._count.assets === 1 ? "image" : "images"}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
