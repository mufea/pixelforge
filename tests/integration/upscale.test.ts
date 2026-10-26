import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { GET as downloadRoute } from "@/app/api/assets/[id]/download/route";
import { POST as createJobRoute } from "@/app/api/jobs/route";
import { GET as getJobRoute } from "@/app/api/jobs/[id]/route";
import { PUT as storagePut } from "@/app/api/storage/objects/route";
import { completeUpload, createUploadIntent, getOwnedAsset } from "@/lib/assets/service";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { getEnv, resetEnvCache } from "@/lib/env";
import { setFalSubscriberForTests } from "@/lib/ai/providers/fal-client";
import { grantCredits } from "@/lib/billing/service";
import { createUpscaleJob } from "@/lib/jobs/service";
import { processJob } from "@/lib/jobs/processor";
import { createProject } from "@/lib/projects/service";
import { resetRateLimits } from "@/lib/rate-limit";
import { getStorage, setStorageForTests } from "@/lib/storage";
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
  const email = `phase43-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Phase 4.3", email, password },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  await grantCredits(signedUp.user.id, 1_000, `test-grant:${randomUUID()}`);
  return { userId: signedUp.user.id, cookie: cookieHeader(signIn) };
}

async function uploadPng(userId: string, projectId: string, filename = "source.png") {
  const png = await pngBytes();
  const intent = await createUploadIntent(userId, {
    projectId,
    filename,
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

describe("upscale jobs", () => {
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

  it("creates a private larger derivative and preserves the source", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Upscale", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const before = original.checksumSha256;

    const created = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          operation: "UPSCALE",
          projectId: project.id,
          assetId: original.id,
          scaleFactor: 2,
        }),
      }),
    );
    expect(created.status).toBe(201);
    const jobBody = (await created.json()) as {
      id: string;
      operation: string;
      providerId: string;
      modelId: string;
      storageKey?: string;
    };
    expect(jobBody.operation).toBe("UPSCALE");
    expect(jobBody.providerId).toBe("mock");
    expect(jobBody.modelId).toBe("mock-upscale");
    expect(JSON.stringify(jobBody)).not.toContain("FAL_KEY");
    expect(jobBody.storageKey).toBeUndefined();

    const processed = await processJob(jobBody.id);
    expect(processed.status).toBe("succeeded");
    expect(processed.outputAssetIds).toHaveLength(1);

    const output = await getOwnedAsset(owner.userId, processed.outputAssetIds[0]);
    expect(output.kind).toBe("DERIVATIVE");
    expect(output.mimeType).toBe("image/png");
    expect(output.sourceAssetId).toBe(original.id);
    expect(output.sourceJobId).toBe(jobBody.id);
    expect(output.originalFilename).toBe("source-2x.png");
    expect(output.width).toBe(32);
    expect(output.height).toBe(24);
    expect(output.storageKey).not.toContain("source.png");

    const stored = await getStorage().getObject(output.storageKey);
    expect(stored).not.toBeNull();
    const meta = await sharp(stored!.body).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(24);

    const stillOriginal = await getOwnedAsset(owner.userId, original.id);
    expect(stillOriginal.deletedAt).toBeNull();
    expect(stillOriginal.checksumSha256).toBe(before);
    expect(stillOriginal.width).toBe(16);
    expect(stillOriginal.height).toBe(12);

    const download = await downloadRoute(
      new Request(`http://127.0.0.1:43127/api/assets/${output.id}/download`, {
        headers: { cookie: owner.cookie },
      }),
      { params: Promise.resolve({ id: output.id }) },
    );
    expect(download.status).toBe(200);
    const body = (await download.json()) as { url: string; storageKey?: string };
    expect(body.url).toContain("/api/storage/objects");
    expect(body.url).not.toContain("fal.media");
    expect(body.storageKey).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(output.storageKey);
  });

  it("accepts 3× and 4× and rejects unsupported factors, missing assets, and invalid mime", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Factors", description: "" });
    const original = await uploadPng(owner.userId, project.id);

    for (const scaleFactor of [3, 4] as const) {
      const job = await createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: original.id,
        scaleFactor,
      });
      const processed = await processJob(job.id);
      expect(processed.status).toBe("succeeded");
      const output = await getOwnedAsset(owner.userId, processed.outputAssetIds[0]);
      expect(output.width).toBe(16 * scaleFactor);
      expect(output.height).toBe(12 * scaleFactor);
      expect(output.originalFilename).toBe(`source-${scaleFactor}x.png`);
    }

    await expect(
      createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: original.id,
        scaleFactor: 1,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_UPSCALE_FACTOR" });
    await expect(
      createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: original.id,
        scaleFactor: 5,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_UPSCALE_FACTOR" });

    const badFactor = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          operation: "UPSCALE",
          projectId: project.id,
          assetId: original.id,
          scaleFactor: 1.5,
        }),
      }),
    );
    expect(badFactor.status).toBe(400);
    await expect(badFactor.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_UPSCALE_FACTOR" },
    });

    await expect(
      createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: randomUUID(),
        scaleFactor: 2,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await prisma.asset.update({ where: { id: original.id }, data: { mimeType: "image/gif" } });
    await expect(
      createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: original.id,
        scaleFactor: 2,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_INVALID_MIME" });
  });

  it("hides jobs and derivatives from other users and rejects unauthenticated enqueue", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);
    const project = await createProject(owner.userId, { name: "Private upscale", description: "" });
    const otherProject = await createProject(owner.userId, { name: "Other", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const job = await createUpscaleJob(owner.userId, {
      operation: "UPSCALE",
      projectId: project.id,
      assetId: original.id,
      scaleFactor: 2,
    });
    const processed = await processJob(job.id);
    const outputId = processed.outputAssetIds[0];

    const stolenJob = await getJobRoute(
      new Request(`http://127.0.0.1:43127/api/jobs/${job.id}`, { headers: { cookie: stranger.cookie } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(stolenJob.status).toBe(404);

    const stolenDownload = await downloadRoute(
      new Request(`http://127.0.0.1:43127/api/assets/${outputId}/download`, {
        headers: { cookie: stranger.cookie },
      }),
      { params: Promise.resolve({ id: outputId }) },
    );
    expect(stolenDownload.status).toBe(404);

    await expect(
      createUpscaleJob(stranger.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: original.id,
        scaleFactor: 2,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: otherProject.id,
        assetId: original.id,
        scaleFactor: 2,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const unauthenticated = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          operation: "UPSCALE",
          projectId: project.id,
          assetId: original.id,
          scaleFactor: 2,
        }),
      }),
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("rejects oversized output, quota exhaustion, missing bytes, and missing Fal config", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Limits", description: "" });
    const original = await uploadPng(owner.userId, project.id);

    vi.stubEnv("MAX_IMAGE_EDGE_PX", "20");
    resetEnvCache();
    await expect(
      createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: original.id,
        scaleFactor: 2,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_IMAGE_TOO_LARGE" });
    vi.unstubAllEnvs();
    resetEnvCache();

    await prisma.asset.update({
      where: { id: original.id },
      data: { byteSize: getEnv().MAX_UPLOAD_BYTES + 1 },
    });
    await expect(
      createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: original.id,
        scaleFactor: 2,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FILE_TOO_LARGE" });
    await prisma.asset.update({
      where: { id: original.id },
      data: { byteSize: original.byteSize },
    });

    await prisma.userProfile.update({
      where: { userId: owner.userId },
      data: { storageUsedBytes: getEnv().STORAGE_QUOTA_BYTES },
    });
    await expect(
      createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: original.id,
        scaleFactor: 2,
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    await prisma.userProfile.update({
      where: { userId: owner.userId },
      data: { storageUsedBytes: original.byteSize },
    });

    const missingBytes = await createUpscaleJob(owner.userId, {
      operation: "UPSCALE",
      projectId: project.id,
      assetId: original.id,
      scaleFactor: 2,
    });
    await getStorage().deleteObject(original.storageKey);
    const failedMissing = await processJob(missingBytes.id);
    expect(failedMissing.status).toBe("failed");
    expect(failedMissing.errorCode).toBe("ASSET_BYTES_MISSING");
    expect(await getOwnedAsset(owner.userId, original.id)).toMatchObject({ id: original.id, deletedAt: null });

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER_MODE", "live");
    vi.stubEnv("FAL_KEY", "");
    vi.stubEnv("FAL_API_KEY", "");
    resetEnvCache();
    const replacement = await uploadPng(owner.userId, project.id, "live.png");
    await expect(
      createUpscaleJob(owner.userId, {
        operation: "UPSCALE",
        projectId: project.id,
        assetId: replacement.id,
        scaleFactor: 2,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("does not persist a derivative when storage write fails", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Rollback upscale", description: "" });
    const original = await uploadPng(owner.userId, project.id);

    const inner = new MemoryStorage();
    const source = await getStorage().getObject(original.storageKey);
    if (source) {
      await inner.putObject(original.storageKey, source.body, source.contentType);
    }
    setStorageForTests({
      driver: "memory",
      putObject: async (key, body, contentType) => {
        if (key.includes("/assets/") && key !== original.storageKey) {
          throw new Error("disk full");
        }
        await inner.putObject(key, body, contentType);
      },
      getObject: (key) => inner.getObject(key),
      deleteObject: (key) => inner.deleteObject(key),
      presignPut: (key, contentType, expires) => inner.presignPut(key, contentType, expires),
      presignGet: (key, expires) => inner.presignGet(key, expires),
    });

    const job = await createUpscaleJob(owner.userId, {
      operation: "UPSCALE",
      projectId: project.id,
      assetId: original.id,
      scaleFactor: 2,
    });
    await expect(processJob(job.id)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect((await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("queued");
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(0);
    expect(await getOwnedAsset(owner.userId, original.id)).toMatchObject({ id: original.id });
  });

  it("reuses an existing derivative instead of calling the provider again", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Reuse upscale", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const job = await createUpscaleJob(owner.userId, {
      operation: "UPSCALE",
      projectId: project.id,
      assetId: original.id,
      scaleFactor: 2,
    });
    const first = await processJob(job.id);
    const second = await processJob(job.id);
    expect(second.outputAssetIds).toEqual(first.outputAssetIds);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(1);
  });

  it("retries Fal rate limits then fails closed, and rejects a non-upscaled Fal result", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Fal retry", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const job = await createUpscaleJob(owner.userId, {
      operation: "UPSCALE",
      projectId: project.id,
      assetId: original.id,
      scaleFactor: 2,
    });
    await prisma.aIJob.update({
      where: { id: job.id },
      data: { providerId: "fal", modelId: "fal-ai/flux-vision-upscaler" },
    });

    vi.stubEnv("FAL_KEY", "fal_sk_test_not_real");
    resetEnvCache();
    setFalSubscriberForTests(async () => {
      throw Object.assign(new Error("slow"), { status: 429 });
    });
    await expect(processJob(job.id)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    const retried = await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(retried.status).toBe("queued");
    expect(retried.attemptCount).toBe(1);
    expect(retried.errorCode).toBe("PROVIDER_RATE_LIMITED");

    await expect(processJob(job.id)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    expect((await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } })).attemptCount).toBe(2);

    await expect(processJob(job.id)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    const exhausted = await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(exhausted.status).toBe("failed");
    expect(exhausted.attemptCount).toBe(3);
    expect(exhausted.errorCode).toBe("PROVIDER_RATE_LIMITED");

    const tiny = await pngBytes(8, 6);
    const shrinkJob = await createUpscaleJob(owner.userId, {
      operation: "UPSCALE",
      projectId: project.id,
      assetId: original.id,
      scaleFactor: 2,
    });
    await prisma.aIJob.update({
      where: { id: shrinkJob.id },
      data: { providerId: "fal", modelId: "fal-ai/flux-vision-upscaler" },
    });
    setFalSubscriberForTests(async () => ({
      data: { image: { content: tiny.toString("base64") } },
    }));
    const rejected = await processJob(shrinkJob.id);
    expect(rejected.status).toBe("failed");
    expect(rejected.errorCode).toBe("PROVIDER_REJECTED");
    expect(await prisma.asset.count({ where: { sourceJobId: shrinkJob.id } })).toBe(0);
    expect((await getOwnedAsset(owner.userId, original.id)).checksumSha256).toBe(original.checksumSha256);
  });
});
