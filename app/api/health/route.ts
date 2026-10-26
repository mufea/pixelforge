import { livenessPayload } from "@/lib/health";

export async function GET() {
  return Response.json(livenessPayload());
}
