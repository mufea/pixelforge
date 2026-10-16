import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetGrid } from "@/components/assets/asset-grid";
import { AssetUploader } from "@/components/assets/uploader";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { ProjectForm } from "@/components/projects/project-form";
import { GeneratePanel } from "@/components/jobs/generate-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createDownloadUrl, listProjectAssets } from "@/lib/assets/service";
import { requireUser } from "@/lib/auth/session";
import { getEnv, isMockAiAllowed, isOpenAIConfigured } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { listProjectJobs, publicJob } from "@/lib/jobs/service";
import { getOwnedProject } from "@/lib/projects/service";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  const { id } = await params;

  let project;
  try {
    project = await getOwnedProject(session.user.id, id);
  } catch (error) {
    if (error instanceof DomainError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const env = getEnv();
  const generateAvailable = env.AI_JOBS_ENABLED && (isMockAiAllowed(env) || isOpenAIConfigured(env));
  const [assets, jobs] = await Promise.all([
    listProjectAssets(session.user.id, project.id),
    listProjectJobs(session.user.id, project.id),
  ]);
  const cards = await Promise.all(
    assets.map(async (asset) => {
      try {
        const download = await createDownloadUrl(session.user.id, asset.id);
        return {
          id: asset.id,
          originalFilename: asset.originalFilename,
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          width: asset.width,
          height: asset.height,
          kind: asset.kind,
          previewUrl: download.url,
          previewError: null,
        };
      } catch {
        return {
          id: asset.id,
          originalFilename: asset.originalFilename,
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          width: asset.width,
          height: asset.height,
          kind: asset.kind,
          previewUrl: null,
          previewError: "Signed preview could not be issued",
        };
      }
    }),
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/app/projects" className="underline-offset-4 hover:underline">
            Projects
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{project.name}</h1>
        <p className="mt-2 text-muted-foreground">{project.description || "No description"}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>Files are private. Access uses a short-lived URL after an ownership check.</CardDescription>
        </CardHeader>
        <CardContent>
          <AssetUploader projectId={project.id} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Generate</CardTitle>
          <CardDescription>
            Text-to-image jobs run in the worker. Live mode never returns a fake image when no provider key is set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GeneratePanel
            projectId={project.id}
            initialJobs={jobs.map(publicJob)}
            available={generateAvailable}
            unavailableReason={
              generateAvailable
                ? null
                : "OpenAI is not configured. Set OPENAI_API_KEY on the server, or use AI_PROVIDER_MODE=mock in development tests."
            }
          />
        </CardContent>
      </Card>
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Library</h2>
        <AssetGrid projectId={project.id} assets={cards} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Project settings</CardTitle>
          <CardDescription>Renaming does not change ownership. Delete hides the project from your library.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ProjectForm
            projectId={project.id}
            defaultValues={{ name: project.name, description: project.description ?? "" }}
          />
          <DeleteProjectButton projectId={project.id} name={project.name} />
        </CardContent>
      </Card>
    </div>
  );
}
