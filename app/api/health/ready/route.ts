import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const storage = getStorage();
    return Response.json({
      ok: true,
      postgres: "up",
      storage: storage.driver,
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
