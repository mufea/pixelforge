import { Readable } from "node:stream";
import { exportProjectProcessedAssets } from "@/lib/export/project-zip";
import { assertSameOrigin } from "@/lib/http/origin";
import { jsonError } from "@/lib/http/responses";
import { requireUserFromRequest } from "@/lib/http/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireUserFromRequest(request);
    const { id } = await context.params;
    let body: unknown = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await request.json();
      } catch {
        body = {};
      }
    }
    const exported = await exportProjectProcessedAssets(session.user.id, id, body);
    const webStream = Readable.toWeb(exported.stream) as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${exported.filename}"`,
        "cache-control": "no-store",
        "x-file-count": String(exported.fileCount),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
