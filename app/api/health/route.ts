export async function GET() {
  return Response.json({
    ok: true,
    service: "pixelforge-web",
    timestamp: new Date().toISOString(),
  });
}
