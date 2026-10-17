import { getCreditLedger, parseLedgerLimit } from "@/lib/billing/service";
import { DomainError } from "@/lib/errors";
import { jsonError } from "@/lib/http/responses";
import { requireUserFromRequest } from "@/lib/http/session";

export async function GET(request: Request) {
  try {
    const session = await requireUserFromRequest(request);
    const url = new URL(request.url);
    if (url.searchParams.has("userId")) {
      throw new DomainError("VALIDATION", "userId cannot be supplied by the client");
    }
    const limit = parseLedgerLimit(url.searchParams.get("limit"));
    const cursor = url.searchParams.get("cursor");
    const page = await getCreditLedger(session.user.id, { limit, cursor });
    return Response.json(page);
  } catch (error) {
    return jsonError(error);
  }
}
