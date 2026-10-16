import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST as batchConvertRoute } from "@/app/api/projects/[id]/convert/route";
import { PUT as storagePut } from "@/app/api/storage/objects/route";
import { convertOwnedAsset, convertOwnedAssetBatch } from "@/lib/assets/convert";
import { completeUpload, createUploadIntent, getOwnedAsset } from "@/lib/assets/service";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { MAX_BATCH_ASSETS } from "@/lib/validators/convert";
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
  const email = `phase41-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Phase Four One", email, password },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return { userId: signedUp.user.id, cookie: cookieHeader(signIn) };
}

async function uploadPng(userId: string, projectId: string, width = 16, height = 12) {
  const png = await pngBytes(width, height);
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

describe("batch convert, resize, and crop", () => {
  const userIds: string[] = [];

  afterEach(() => {
    setStorageForTests(null);
    resetMemoryStorage();
    resetRateLimits();
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("converts a batch, resizes, and preserves originals", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Batch", description: "" });
    const first = await uploadPng(owner.userId, project.id);
    const second = await uploadPng(owner.userId, project.id);

    const result = await convertOwnedAssetBatch(owner.userId, project.id, {
      assetIds: [first.id, second.id],
      outputFormat: "image/webp",
      width: 8,
      height: 6,
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.output.mimeType).toBe("image/webp");
    expect(result.results[0]?.output.width).toBe(8);
    expect(result.results[0]?.output.height).toBe(6);
    expect(await getOwnedAsset(owner.userId, first.id)).toMatchObject({ mimeType: "image/png", deletedAt: null });
    expect(await prisma.asset.count({ where: { userId: owner.userId, deletedAt: null } })).toBe(4);
  });

  it("crops a single asset over the existing sync convert route", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Crop", description: "" });
    const original = await uploadPng(owner.userId, project.id, 16, 12);
    const cropped = await convertOwnedAsset(owner.userId, original.id, {
      outputFormat: "image/jpeg",
      crop: { left: 2, top: 2, width: 8, height: 6 },
    });
    expect(cropped.output.width).toBe(8);
    expect(cropped.output.height).toBe(6);
    expect(cropped.output.mimeType).toBe("image/jpeg");
    expect(cropped.original.id).toBe(original.id);
  });

  it("rejects oversized batches and invalid formats before writing outputs", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Limits", description: "" });
    const original = await uploadPng(owner.userId, project.id);

    await expect(
      convertOwnedAssetBatch(owner.userId, project.id, {
        assetIds: Array.from({ length: MAX_BATCH_ASSETS + 1 }, () => randomUUID()),
        outputFormat: "image/png",
      }),
    ).rejects.toMatchObject({ code: "BATCH_TOO_LARGE" });

    await expect(
      convertOwnedAssetBatch(owner.userId, project.id, {
        assetIds: [original.id],
        outputFormat: "image/avif",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OUTPUT_FORMAT" });

    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(0);
  });

  it("rejects the whole batch when any asset is not owned", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);
    const project = await createProject(owner.userId, { name: "Mine", description: "" });
    const otherProject = await createProject(stranger.userId, { name: "Theirs", description: "" });
    const mine = await uploadPng(owner.userId, project.id);
    const theirs = await uploadPng(stranger.userId, otherProject.id);

    await expect(
      convertOwnedAssetBatch(owner.userId, project.id, {
        assetIds: [mine.id, theirs.id],
        outputFormat: "image/webp",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(0);

    const unauthenticated = await batchConvertRoute(
      new Request(`http://127.0.0.1:43127/api/projects/${project.id}/convert`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ assetIds: [mine.id], outputFormat: "image/webp" }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(unauthenticated.status).toBe(401);

    const stolen = await batchConvertRoute(
      new Request(`http://127.0.0.1:43127/api/projects/${project.id}/convert`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: stranger.cookie },
        body: JSON.stringify({ assetIds: [mine.id], outputFormat: "image/webp" }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(stolen.status).toBe(404);
  });

  it("rolls back completed outputs when a later persist fails", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Rollback", description: "" });
    const first = await uploadPng(owner.userId, project.id);
    const second = await uploadPng(owner.userId, project.id);

    const inner = new MemoryStorage();
    for (const source of [first, second]) {
      const stored = await getStorage().getObject(source.storageKey);
      if (stored) {
        await inner.putObject(source.storageKey, stored.body, stored.contentType);
      }
    }
    let newPuts = 0;
    setStorageForTests({
      driver: "memory",
      putObject: async (key, body, contentType) => {
        if (key.includes("/assets/") && key !== first.storageKey && key !== second.storageKey) {
          newPuts += 1;
          if (newPuts > 1) {
            throw new Error("disk full");
          }
        }
        await inner.putObject(key, body, contentType);
      },
      getObject: (key) => inner.getObject(key),
      deleteObject: (key) => inner.deleteObject(key),
      presignPut: (key, contentType, expires) => inner.presignPut(key, contentType, expires),
      presignGet: (key, expires) => inner.presignGet(key, expires),
    });

    await expect(
      convertOwnedAssetBatch(owner.userId, project.id, {
        assetIds: [first.id, second.id],
        outputFormat: "image/jpeg",
      }),
    ).rejects.toThrow(/disk full/);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(0);
    expect(await getOwnedAsset(owner.userId, first.id)).toMatchObject({ id: first.id });
    expect(await getOwnedAsset(owner.userId, second.id)).toMatchObject({ id: second.id });
  });
});
