import { convertOwnedAsset } from "@/lib/assets/convert";
import { DomainError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { jsonError } from "@/lib/http/responses";
import { requireUserFromRequest } from "@/lib/http/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireUserFromRequest(request);
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new DomainError("VALIDATION", "Request body must be JSON");
    }
    const result = await convertOwnedAsset(session.user.id, id, body);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
