import { completeUpload } from "@/lib/assets/service";
import { assertSameOrigin } from "@/lib/http/origin";
import { jsonError } from "@/lib/http/responses";
import { requireUserFromRequest } from "@/lib/http/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireUserFromRequest(request);
    const { id } = await context.params;
    const asset = await completeUpload(session.user.id, id);
    return Response.json({
      id: asset.id,
      projectId: asset.projectId,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      originalFilename: asset.originalFilename,
    });
  } catch (error) {
    return jsonError(error);
  }
}
