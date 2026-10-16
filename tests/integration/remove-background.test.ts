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
import { createRemoveBackgroundJob } from "@/lib/jobs/service";
import { processJob } from "@/lib/jobs/processor";
import { createProject } from "@/lib/projects/service";
import { resetRateLimits } from "@/lib/rate-limit";
import { getStorage, setStorageForTests } from "@/lib/storage";
import { MemoryStorage, resetMemoryStorage } from "@/lib/storage/memory";

const password = "CorrectHorse!9";
const origin = "http://127.0.0.1:43127";

async function pngBytes() {
  return sharp({
    create: { width: 16, height: 12, channels: 3, background: { r: 16, g: 80, b: 140 } },
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
  const email = `phase42-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Phase 4.2", email, password },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
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

describe("background removal jobs", () => {
  const userIds: string[] = [];

  afterEach(() => {
    setStorageForTests(null);
    resetMemoryStorage();
    resetRateLimits();
    resetEnvCache();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("creates a private transparent derivative and preserves the source", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "BG", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const before = original.checksumSha256;

    const job = await createRemoveBackgroundJob(owner.userId, {
      operation: "REMOVE_BACKGROUND",
      projectId: project.id,
      assetId: original.id,
    });
    expect(job.providerId).toBe("mock");
    expect(job.modelId).toBe("mock-bg-remove");

    const processed = await processJob(job.id);
    expect(processed.status).toBe("succeeded");
    expect(processed.outputAssetIds).toHaveLength(1);

    const output = await getOwnedAsset(owner.userId, processed.outputAssetIds[0]);
    expect(output.kind).toBe("DERIVATIVE");
    expect(output.mimeType).toBe("image/png");
    expect(output.sourceAssetId).toBe(original.id);
    expect(output.sourceJobId).toBe(job.id);
    expect(output.originalFilename).toBe("source-no-bg.png");

    const stored = await getStorage().getObject(output.storageKey);
    expect(stored).not.toBeNull();
    const meta = await sharp(stored!.body).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(16);
    expect(meta.height).toBe(12);

    const stillOriginal = await getOwnedAsset(owner.userId, original.id);
    expect(stillOriginal.deletedAt).toBeNull();
    expect(stillOriginal.checksumSha256).toBe(before);
    expect(stillOriginal.mimeType).toBe("image/png");

    const download = await downloadRoute(
      new Request(`http://127.0.0.1:43127/api/assets/${output.id}/download`, {
        headers: { cookie: owner.cookie },
      }),
      { params: Promise.resolve({ id: output.id }) },
    );
    expect(download.status).toBe(200);
    const body = (await download.json()) as { url: string };
    expect(body.url).toContain("/api/storage/objects");
  });

  it("hides jobs and derivatives from other users and rejects unauthenticated enqueue", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);
    const project = await createProject(owner.userId, { name: "Private BG", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const job = await createRemoveBackgroundJob(owner.userId, {
      operation: "REMOVE_BACKGROUND",
      projectId: project.id,
      assetId: original.id,
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
      createRemoveBackgroundJob(stranger.userId, {
        operation: "REMOVE_BACKGROUND",
        projectId: project.id,
        assetId: original.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const unauthenticated = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ operation: "REMOVE_BACKGROUND", projectId: project.id, assetId: original.id }),
      }),
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("rejects unsupported formats and missing configuration", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Bad BG", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    await prisma.asset.update({ where: { id: original.id }, data: { mimeType: "image/gif" } });

    await expect(
      createRemoveBackgroundJob(owner.userId, {
        operation: "REMOVE_BACKGROUND",
        projectId: project.id,
        assetId: original.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_INVALID_MIME" });

    await prisma.userProfile.update({
      where: { userId: owner.userId },
      data: { storageUsedBytes: getEnv().STORAGE_QUOTA_BYTES },
    });
    await prisma.asset.update({ where: { id: original.id }, data: { mimeType: "image/png" } });
    await expect(
      createRemoveBackgroundJob(owner.userId, {
        operation: "REMOVE_BACKGROUND",
        projectId: project.id,
        assetId: original.id,
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    await prisma.userProfile.update({
      where: { userId: owner.userId },
      data: { storageUsedBytes: original.byteSize },
    });

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER_MODE", "live");
    vi.stubEnv("FAL_KEY", "");
    vi.stubEnv("FAL_API_KEY", "");
    resetEnvCache();
    await prisma.asset.update({ where: { id: original.id }, data: { mimeType: "image/png" } });
    await expect(
      createRemoveBackgroundJob(owner.userId, {
        operation: "REMOVE_BACKGROUND",
        projectId: project.id,
        assetId: original.id,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("does not persist a derivative when storage write fails", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Rollback BG", description: "" });
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

    const job = await createRemoveBackgroundJob(owner.userId, {
      operation: "REMOVE_BACKGROUND",
      projectId: project.id,
      assetId: original.id,
    });
    const processed = await processJob(job.id);
    expect(processed.status).toBe("failed");
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(0);
    expect(await getOwnedAsset(owner.userId, original.id)).toMatchObject({ id: original.id });
  });

  it("reuses an existing derivative instead of calling the provider again", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Reuse BG", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const job = await createRemoveBackgroundJob(owner.userId, {
      operation: "REMOVE_BACKGROUND",
      projectId: project.id,
      assetId: original.id,
    });
    const first = await processJob(job.id);
    const second = await processJob(job.id);
    expect(second.outputAssetIds).toEqual(first.outputAssetIds);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(1);
  });
});
