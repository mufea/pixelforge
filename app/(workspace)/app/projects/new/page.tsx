import type { Metadata } from "next";
import Link from "next/link";
import { ProjectForm } from "@/components/projects/project-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  await requireUser();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">New project</h1>
        <p className="mt-2 text-muted-foreground">
          The project is stored under your user id. Changing the URL later cannot expose it to someone else.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            <Link href="/app/projects" className="underline-offset-4 hover:underline">
              Back to library
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm defaultValues={{ name: "", description: "" }} />
        </CardContent>
      </Card>
    </div>
  );
}
