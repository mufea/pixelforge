import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST as convertRoute } from "@/app/api/assets/[id]/convert/route";
import { GET as downloadRoute } from "@/app/api/assets/[id]/download/route";
import { PUT as storagePut } from "@/app/api/storage/objects/route";
import { convertOwnedAsset } from "@/lib/assets/convert";
import { persistDerivedAsset } from "@/lib/assets/persist";
import { completeUpload, createUploadIntent, getOwnedAsset } from "@/lib/assets/service";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
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
  const email = `phase3-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Phase Three", email, password },
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

describe("image conversion", () => {
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

  it("creates a derivative and preserves the original", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Convert", description: "" });
    const original = await uploadPng(owner.userId, project.id);

    const result = await convertOwnedAsset(owner.userId, original.id, { outputFormat: "image/jpeg" });
    expect(result.output.mimeType).toBe("image/jpeg");
    expect(result.output.kind).toBe("DERIVATIVE");
    expect(result.original.id).toBe(original.id);
    expect(result.output.id).not.toBe(original.id);
    expect(result.output.originalFilename).toBe("source.jpg");

    const stillOriginal = await getOwnedAsset(owner.userId, original.id);
    expect(stillOriginal.deletedAt).toBeNull();
    expect(stillOriginal.mimeType).toBe("image/png");
    expect(await prisma.asset.count({ where: { userId: owner.userId, deletedAt: null } })).toBe(2);
  });

  it("rejects unsupported output formats and unauthorized conversion", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);
    const project = await createProject(owner.userId, { name: "Lock", description: "" });
    const original = await uploadPng(owner.userId, project.id);

    await expect(
      convertOwnedAsset(owner.userId, original.id, { outputFormat: "image/avif" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OUTPUT_FORMAT" });

    await expect(convertOwnedAsset(stranger.userId, original.id, { outputFormat: "image/webp" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const unauthenticated = await convertRoute(
      new Request(`http://127.0.0.1:43127/api/assets/${original.id}/convert`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ outputFormat: "image/webp" }),
      }),
      { params: Promise.resolve({ id: original.id }) },
    );
    expect(unauthenticated.status).toBe(401);

    const stolen = await convertRoute(
      new Request(`http://127.0.0.1:43127/api/assets/${original.id}/convert`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: stranger.cookie },
        body: JSON.stringify({ outputFormat: "image/webp" }),
      }),
      { params: Promise.resolve({ id: original.id }) },
    );
    expect(stolen.status).toBe(404);

    const download = await downloadRoute(
      new Request(`http://127.0.0.1:43127/api/assets/${original.id}/download`, {
        headers: { cookie: stranger.cookie },
      }),
      { params: Promise.resolve({ id: original.id }) },
    );
    expect(download.status).toBe(404);
  });

  it("deletes incomplete objects when storage write fails", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Fail", description: "" });
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

    await expect(convertOwnedAsset(owner.userId, original.id, { outputFormat: "image/webp" })).rejects.toThrow(/disk full/);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "DERIVATIVE" } })).toBe(0);
    expect(await getOwnedAsset(owner.userId, original.id)).toMatchObject({ id: original.id });
  });

  it("deletes the object when the database write fails after storage put", async () => {
    const png = await pngBytes();
    const inner = new MemoryStorage();
    const deleted: string[] = [];
    setStorageForTests({
      driver: "memory",
      putObject: (key, body, contentType) => inner.putObject(key, body, contentType),
      getObject: (key) => inner.getObject(key),
      deleteObject: async (key) => {
        deleted.push(key);
        await inner.deleteObject(key);
      },
      presignPut: (key, contentType, expires) => inner.presignPut(key, contentType, expires),
      presignGet: (key, expires) => inner.presignGet(key, expires),
    });

    await expect(
      persistDerivedAsset({
        userId: randomUUID(),
        projectId: null,
        kind: "DERIVATIVE",
        mimeType: "image/png",
        bytes: png,
        width: 16,
        height: 12,
        originalFilename: "orphan.png",
      }),
    ).rejects.toThrow();

    expect(deleted).toHaveLength(1);
    expect(await inner.getObject(deleted[0])).toBeNull();
    expect(await prisma.asset.count({ where: { originalFilename: "orphan.png" } })).toBe(0);
  });
});
