import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({
      ok: true,
      postgres: "up",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      {
        ok: false,
        postgres: "down",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
