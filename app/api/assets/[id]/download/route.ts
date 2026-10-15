import { createDownloadUrl } from "@/lib/assets/service";
import { jsonError } from "@/lib/http/responses";
import { requireUserFromRequest } from "@/lib/http/session";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUserFromRequest(request);
    const { id } = await context.params;
    const result = await createDownloadUrl(session.user.id, id);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
