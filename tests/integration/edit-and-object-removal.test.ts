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
import { createEditJob, createRemoveObjectJob } from "@/lib/jobs/service";
import { processJob } from "@/lib/jobs/processor";
import { createProject } from "@/lib/projects/service";
import { resetRateLimits } from "@/lib/rate-limit";
import { getStorage, setStorageForTests } from "@/lib/storage";
import { MemoryStorage, resetMemoryStorage } from "@/lib/storage/memory";

const password = "CorrectHorse!9";
const origin = "http://127.0.0.1:43127";

async function pngBytes(width = 16, height = 12, color = { r: 16, g: 80, b: 140 }) {
  return sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

async function selectionMask(width = 16, height = 12) {
  const white = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: white, left: 0, top: 0 }])
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
  const email = `phase44-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Phase 4.4", email, password },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return { userId: signedUp.user.id, cookie: cookieHeader(signIn) };
}

async function uploadPng(
  userId: string,
  projectId: string,
  filename: string,
  bytes: Buffer,
  mimeType: "image/png" = "image/png",
) {
  const intent = await createUploadIntent(userId, {
    projectId,
    filename,
    mimeType,
    byteSize: bytes.byteLength,
  });
  await storagePut(
    new Request(`http://127.0.0.1:43127${intent.uploadUrl}`, {
      method: "PUT",
      headers: { "content-type": mimeType },
      body: new Uint8Array(bytes),
    }),
  );
  return completeUpload(userId, intent.intentId);
}

describe("edit and object-removal jobs", () => {
  const userIds: string[] = [];

  afterEach(() => {
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

  it("creates a private edit derivative and preserves the source", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Edit", description: "" });
    const original = await uploadPng(owner.userId, project.id, "source.png", await pngBytes());
    const before = original.checksumSha256;

    const created = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          operation: "EDIT",
          projectId: project.id,
          assetId: original.id,
          prompt: "make the mug warmer",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const jobBody = (await created.json()) as { id: string; operation: string; providerId: string; modelId: string };
    expect(jobBody.operation).toBe("EDIT");
    expect(jobBody.providerId).toBe("mock");
    expect(jobBody.modelId).toBe("mock-edit");
    expect(JSON.stringify(jobBody)).not.toContain("OPENAI_API_KEY");

    const processed = await processJob(jobBody.id);
    expect(processed.status).toBe("succeeded");
    const output = await getOwnedAsset(owner.userId, processed.outputAssetIds[0]);
    expect(output.kind).toBe("DERIVATIVE");
    expect(output.sourceAssetId).toBe(original.id);
    expect(output.originalFilename).toBe("source-edit.png");
    expect(output.width).toBe(16);
    expect(output.height).toBe(12);

    const stillOriginal = await getOwnedAsset(owner.userId, original.id);
    expect(stillOriginal.checksumSha256).toBe(before);
    expect(stillOriginal.deletedAt).toBeNull();

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

  it("creates a private object-removal derivative from a same-size mask", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Erase", description: "" });
    const original = await uploadPng(owner.userId, project.id, "source.png", await pngBytes());
    const mask = await uploadPng(owner.userId, project.id, "mask.png", await selectionMask());
    const before = original.checksumSha256;

    const job = await createRemoveObjectJob(owner.userId, {
      operation: "REMOVE_OBJECT",
      projectId: project.id,
      assetId: original.id,
      maskAssetId: mask.id,
    });
    expect(job.providerId).toBe("mock");
    const processed = await processJob(job.id);
    expect(processed.status).toBe("succeeded");
    const output = await getOwnedAsset(owner.userId, processed.outputAssetIds[0]);
    expect(output.kind).toBe("DERIVATIVE");
    expect(output.originalFilename).toBe("source-removed.png");
    expect(output.sourceAssetId).toBe(original.id);
    expect((await getOwnedAsset(owner.userId, original.id)).checksumSha256).toBe(before);
  });

  it("rejects missing prompts, missing masks, mismatched masks, and invalid mime", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Invalid", description: "" });
    const original = await uploadPng(owner.userId, project.id, "source.png", await pngBytes());
    const smallMask = await uploadPng(owner.userId, project.id, "small-mask.png", await selectionMask(8, 6));
    const emptyMask = await uploadPng(
      owner.userId,
      project.id,
      "empty-mask.png",
      await pngBytes(16, 12, { r: 0, g: 0, b: 0 }),
    );

    await expect(
      createEditJob(owner.userId, {
        operation: "EDIT",
        projectId: project.id,
        assetId: original.id,
        prompt: "x",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await expect(
      createRemoveObjectJob(owner.userId, {
        operation: "REMOVE_OBJECT",
        projectId: project.id,
        assetId: original.id,
      }),
    ).rejects.toMatchObject({ code: "MASK_REQUIRED" });

    await expect(
      createRemoveObjectJob(owner.userId, {
        operation: "REMOVE_OBJECT",
        projectId: project.id,
        assetId: original.id,
        maskAssetId: original.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_MASK" });

    await expect(
      createRemoveObjectJob(owner.userId, {
        operation: "REMOVE_OBJECT",
        projectId: project.id,
        assetId: original.id,
        maskAssetId: smallMask.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_MASK_SIZE" });

    const emptyJob = await createRemoveObjectJob(owner.userId, {
      operation: "REMOVE_OBJECT",
      projectId: project.id,
      assetId: original.id,
      maskAssetId: emptyMask.id,
    });
    const emptyProcessed = await processJob(emptyJob.id);
    expect(emptyProcessed.status).toBe("failed");
    expect(emptyProcessed.errorCode).toBe("VALIDATION_MASK_EMPTY");

    await prisma.asset.update({ where: { id: original.id }, data: { mimeType: "image/gif" } });
    await expect(
      createEditJob(owner.userId, {
        operation: "EDIT",
        projectId: project.id,
        assetId: original.id,
        prompt: "make it blue",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_INVALID_MIME" });
  });

  it("hides jobs from other users and rejects unauthenticated enqueue", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);
    const project = await createProject(owner.userId, { name: "Private edit", description: "" });
    const original = await uploadPng(owner.userId, project.id, "source.png", await pngBytes());
    const mask = await uploadPng(owner.userId, project.id, "mask.png", await selectionMask());
    const job = await createEditJob(owner.userId, {
      operation: "EDIT",
      projectId: project.id,
      assetId: original.id,
      prompt: "add a soft shadow",
    });
    const processed = await processJob(job.id);
    const outputId = processed.outputAssetIds[0];

    expect(
      (await getJobRoute(new Request(`http://127.0.0.1:43127/api/jobs/${job.id}`, { headers: { cookie: stranger.cookie } }), {
        params: Promise.resolve({ id: job.id }),
      })).status,
    ).toBe(404);
    expect(
      (
        await downloadRoute(
          new Request(`http://127.0.0.1:43127/api/assets/${outputId}/download`, { headers: { cookie: stranger.cookie } }),
          { params: Promise.resolve({ id: outputId }) },
        )
      ).status,
    ).toBe(404);

    await expect(
      createRemoveObjectJob(stranger.userId, {
        operation: "REMOVE_OBJECT",
        projectId: project.id,
        assetId: original.id,
        maskAssetId: mask.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const unauthenticated = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          operation: "EDIT",
          projectId: project.id,
          assetId: original.id,
          prompt: "nope",
        }),
      }),
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("returns PROVIDER_NOT_CONFIGURED in live mode without keys", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "No keys", description: "" });
    const original = await uploadPng(owner.userId, project.id, "source.png", await pngBytes());
    const mask = await uploadPng(owner.userId, project.id, "mask.png", await selectionMask());

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AI_PROVIDER_MODE", "live");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("FAL_KEY", "");
    vi.stubEnv("FAL_API_KEY", "");
    resetEnvCache();

    await expect(
      createEditJob(owner.userId, {
        operation: "EDIT",
        projectId: project.id,
        assetId: original.id,
        prompt: "make it blue",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    await expect(
      createRemoveObjectJob(owner.userId, {
        operation: "REMOVE_OBJECT",
        projectId: project.id,
        assetId: original.id,
        maskAssetId: mask.id,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("does not persist a derivative when storage write fails and reuses existing output", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Rollback edit", description: "" });
    const original = await uploadPng(owner.userId, project.id, "source.png", await pngBytes());

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

    const failedJob = await createEditJob(owner.userId, {
      operation: "EDIT",
      projectId: project.id,
      assetId: original.id,
      prompt: "make it blue",
    });
    const failed = await processJob(failedJob.id);
    expect(failed.status).toBe("failed");
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(0);

    setStorageForTests(null);
    const reuseJob = await createEditJob(owner.userId, {
      operation: "EDIT",
      projectId: project.id,
      assetId: original.id,
      prompt: "make it blue again",
    });
    const first = await processJob(reuseJob.id);
    const second = await processJob(reuseJob.id);
    expect(second.outputAssetIds).toEqual(first.outputAssetIds);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(1);
  });

  it("retries Fal object-removal rate limits then fails closed", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Fal retry", description: "" });
    const original = await uploadPng(owner.userId, project.id, "source.png", await pngBytes());
    const mask = await uploadPng(owner.userId, project.id, "mask.png", await selectionMask());
    const job = await createRemoveObjectJob(owner.userId, {
      operation: "REMOVE_OBJECT",
      projectId: project.id,
      assetId: original.id,
      maskAssetId: mask.id,
    });
    await prisma.aIJob.update({
      where: { id: job.id },
      data: { providerId: "fal", modelId: "fal-ai/object-removal/mask" },
    });
    vi.stubEnv("FAL_KEY", "fal_sk_test_not_real");
    resetEnvCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));

    await expect(processJob(job.id)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    expect((await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("queued");
    await expect(processJob(job.id)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    await expect(processJob(job.id)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    const exhausted = await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(exhausted.status).toBe("failed");
    expect(exhausted.attemptCount).toBe(3);
    expect(await getOwnedAsset(owner.userId, original.id)).toMatchObject({ checksumSha256: original.checksumSha256 });
  });

  it("rejects quota exhaustion for edits", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Quota", description: "" });
    const original = await uploadPng(owner.userId, project.id, "source.png", await pngBytes());
    await prisma.userProfile.update({
      where: { userId: owner.userId },
      data: { storageUsedBytes: getEnv().STORAGE_QUOTA_BYTES },
    });
    await expect(
      createEditJob(owner.userId, {
        operation: "EDIT",
        projectId: project.id,
        assetId: original.id,
        prompt: "make it blue",
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});
