import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { readinessPayload } from "@/lib/health";
import { getStorage } from "@/lib/storage";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const storage = getStorage();
    const redis = await redisStatus();
    const ok = redis !== "down";
    return Response.json(readinessPayload({ ok, postgres: "up", redis, storage: storage.driver }), {
      status: ok ? 200 : 503,
    });
  } catch {
    return Response.json(readinessPayload({ ok: false, postgres: "down" }), { status: 503 });
  }
}

async function redisStatus(): Promise<"up" | "down" | "unconfigured"> {
  const env = getEnv();
  if (!env.REDIS_URL) {
    return "unconfigured";
  }
  const Redis = (await import("ioredis")).default;
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    lazyConnect: true,
  });
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG" ? "up" : "down";
  } catch {
    return "down";
  } finally {
    client.disconnect();
  }
}
