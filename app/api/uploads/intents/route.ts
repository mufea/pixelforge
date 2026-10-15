import { createUploadIntent } from "@/lib/assets/service";
import { DomainError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http/origin";
import { jsonError } from "@/lib/http/responses";
import { requireUserFromRequest } from "@/lib/http/session";

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
    const result = await createUploadIntent(session.user.id, body);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
