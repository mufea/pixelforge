import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { POST as createJobRoute } from "@/app/api/jobs/route";
import { PUT as storagePut } from "@/app/api/storage/objects/route";
import { completeUpload, createUploadIntent, getOwnedAsset } from "@/lib/assets/service";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { getEnv, resetEnvCache } from "@/lib/env";
import { setFalSubscriberForTests } from "@/lib/ai/providers/fal-client";
import { grantCredits } from "@/lib/billing/service";
import { processJob } from "@/lib/jobs/processor";
import { createProject } from "@/lib/projects/service";
import { resetRateLimits } from "@/lib/rate-limit";
import { setStorageForTests } from "@/lib/storage";
import { MemoryStorage, resetMemoryStorage } from "@/lib/storage/memory";

const password = "CorrectHorse!9";
const origin = "http://127.0.0.1:43127";

async function pngBytes(width = 16, height = 12) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 16, g: 80, b: 140 } },
  })
    .png()
    .toBuffer();
}

function cookieHeader(response: Response) {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (cookies.length > 0) {
    return cookies.map((part) => part.split(";")[0]).join("; ");
  }
  return response.headers.get("set-cookie")?.split(",")[0]?.split(";")[0] ?? "";
}

async function createAccount() {
  const email = `phase48-i2i-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Phase 4.8 i2i", email, password },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  await grantCredits(signedUp.user.id, 1_000, `test-grant:${randomUUID()}`);
  return { userId: signedUp.user.id, cookie: cookieHeader(signIn) };
}

async function uploadPng(userId: string, projectId: string) {
  const png = await pngBytes();
  const intent = await createUploadIntent(userId, {
    projectId,
    filename: "source.png",
    mimeType: "image/png",
    byteSize: png.byteLength,
  });
  await storagePut(
    new Request(`http://127.0.0.1:43127${intent.uploadUrl}`, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(png),
    }),
  );
  return completeUpload(userId, intent.intentId);
}

describe("image-to-image jobs", () => {
  const userIds: string[] = [];

  afterEach(() => {
    setFalSubscriberForTests(null);
    setStorageForTests(null);
    resetMemoryStorage();
    resetRateLimits();
    resetEnvCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("creates a private image-to-image derivative and preserves the source", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "I2I", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const before = original.checksumSha256;

    const created = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          operation: "IMAGE_TO_IMAGE",
          projectId: project.id,
          assetId: original.id,
          prompt: "watercolor still life",
          strength: 0.7,
        }),
      }),
    );
    expect(created.status).toBe(201);
    const jobBody = (await created.json()) as { id: string; operation: string; status: string };
    expect(jobBody.operation).toBe("IMAGE_TO_IMAGE");
    expect(jobBody.status).toBe("queued");

    const processed = await processJob(jobBody.id);
    expect(processed.status).toBe("succeeded");
    expect(processed.outputAssetIds).toHaveLength(1);

    const source = await getOwnedAsset(owner.userId, original.id);
    expect(source.checksumSha256).toBe(before);
    const output = await getOwnedAsset(owner.userId, processed.outputAssetIds[0]!);
    expect(output.kind).toBe("DERIVATIVE");
    expect(output.sourceAssetId).toBe(original.id);
  });

  it("rejects unauthorized jobs and invalid strength", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const stranger = await createAccount();
    userIds.push(stranger.userId);
    const project = await createProject(owner.userId, { name: "I2I private", description: "" });
    const original = await uploadPng(owner.userId, project.id);

    const stolen = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: stranger.cookie },
        body: JSON.stringify({
          operation: "IMAGE_TO_IMAGE",
          projectId: project.id,
          assetId: original.id,
          prompt: "steal this",
        }),
      }),
    );
    expect(stolen.status).toBe(404);

    const invalid = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          operation: "IMAGE_TO_IMAGE",
          projectId: project.id,
          assetId: original.id,
          prompt: "too strong",
          strength: 1.5,
        }),
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it("uses the Fal image-to-image subscriber when the job is pinned to Fal", async () => {
    setStorageForTests(new MemoryStorage());
    vi.stubEnv("NODE_ENV", "test");
    resetEnvCache();
    expect(getEnv().NODE_ENV).toBe("test");
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "I2I fal", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const outputPng = await pngBytes(16, 12);

    const created = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          operation: "IMAGE_TO_IMAGE",
          projectId: project.id,
          assetId: original.id,
          prompt: "studio lighting",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const job = (await created.json()) as { id: string };
    await prisma.aIJob.update({
      where: { id: job.id },
      data: { providerId: "fal", modelId: "fal-ai/flux/dev/image-to-image" },
    });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER_MODE", "live");
    vi.stubEnv("FAL_KEY", "fal_sk_test_not_real");
    vi.stubEnv("OPENAI_API_KEY", "");
    resetEnvCache();
    setFalSubscriberForTests(async (modelId, input) => {
      expect(modelId).toBe("fal-ai/flux/dev/image-to-image");
      expect(input.prompt).toBe("studio lighting");
      return { data: { images: [{ content: outputPng.toString("base64") }] }, requestId: "i2i_live_stub" };
    });
    const processed = await processJob(job.id);
    expect(processed.status).toBe("succeeded");
  });
});
