import { jsonError } from "@/lib/http/responses";
import { requireUserFromRequest } from "@/lib/http/session";
import { getOwnedJob, publicJob } from "@/lib/jobs/service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUserFromRequest(request);
    const { id } = await context.params;
    const job = await getOwnedJob(session.user.id, id);
    return Response.json(publicJob(job));
  } catch (error) {
    return jsonError(error);
  }
}
