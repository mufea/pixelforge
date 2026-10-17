import { getCreditBalance } from "@/lib/billing/service";
import { jsonError } from "@/lib/http/responses";
import { requireUserFromRequest } from "@/lib/http/session";

export async function GET(request: Request) {
  try {
    const session = await requireUserFromRequest(request);
    const balance = await getCreditBalance(session.user.id);
    return Response.json({
      availableCredits: balance.availableCredits,
      reservedCredits: balance.reservedCredits,
    });
  } catch (error) {
    return jsonError(error);
  }
}
