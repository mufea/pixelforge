import { DomainError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { jsonError } from "@/lib/http/responses";
import { requireUserFromRequest } from "@/lib/http/session";
import { createGenerateJob, listProjectJobs, publicJob } from "@/lib/jobs/service";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUserFromRequest(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new DomainError("VALIDATION", "Request body must be JSON");
    }
    const job = await createGenerateJob(session.user.id, body);
    return Response.json(publicJob(job), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireUserFromRequest(request);
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) {
      throw new DomainError("VALIDATION", "projectId is required");
    }
    const jobs = await listProjectJobs(session.user.id, projectId);
    return Response.json({ jobs: jobs.map(publicJob) });
  } catch (error) {
    return jsonError(error);
  }
}
