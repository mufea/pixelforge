import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/assets/quota";
import { getCurrentSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import { listProjects } from "@/lib/projects/service";
import { toolsCatalog } from "@/lib/site";

export const metadata: Metadata = { title: "Workspace" };

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session?.user) {
    return null;
  }

  const [profile, projects] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId: session.user.id } }),
    listProjects(session.user.id),
  ]);
  const quota = getEnv().STORAGE_QUOTA_BYTES;
  const used = profile?.storageUsedBytes ?? 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {profile?.displayName ? `Welcome, ${profile.displayName}` : "Workspace"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Projects and private uploads are live. AI generation, conversion jobs, and payments are not claimed as working yet.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>{session.user.email}</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Storage</CardTitle>
            <CardDescription>
              {formatBytes(used)} of {formatBytes(quota)} used
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Role</CardTitle>
            <CardDescription className="capitalize">{session.user.role}</CardDescription>
          </CardHeader>
        </Card>
      </div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Projects</h2>
        <Button asChild>
          <Link href="/app/projects/new">New project</Link>
        </Button>
      </div>
      {projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              Create a project to upload private images. Other accounts cannot open your files by id.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.slice(0, 4).map((project) => (
            <Link key={project.id} href={`/app/projects/${project.id}`} className="block">
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>
                    {project._count.assets} {project._count.assets === 1 ? "image" : "images"}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Open the full library in{" "}
        <Link href="/app/projects" className="underline-offset-4 hover:underline">
          projects
        </Link>
        .
      </p>
      <div>
        <h2 className="text-xl font-semibold">Upcoming tools</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {toolsCatalog.map((tool) => (
            <Card key={tool.slug}>
              <CardHeader>
                <CardTitle className="text-base">{tool.name}</CardTitle>
                <CardDescription>
                  {tool.summary} <Badge variant="secondary">{tool.status}</Badge>
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
