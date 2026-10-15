import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST as completeUploadRoute } from "@/app/api/uploads/intents/[id]/complete/route";
import { POST as createIntentRoute } from "@/app/api/uploads/intents/route";
import { GET as downloadRoute } from "@/app/api/assets/[id]/download/route";
import { GET as storageGet, PUT as storagePut } from "@/app/api/storage/objects/route";
import { completeUpload, createDownloadUrl, createUploadIntent, getOwnedAsset } from "@/lib/assets/service";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { createProject, getOwnedProject, listProjects, softDeleteProject } from "@/lib/projects/service";
import { resetRateLimits } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";
import { resetMemoryStorage } from "@/lib/storage/memory";

const password = "CorrectHorse!9";
const origin = "http://127.0.0.1:43127";

async function pngBytes(width = 12, height = 10) {
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
  const email = `phase2-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Phase Two", email, password },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return { email, userId: signedUp.user.id, cookie: cookieHeader(signIn) };
}

describe("projects and private assets", () => {
  const userIds: string[] = [];

  afterEach(() => {
    resetMemoryStorage();
    resetRateLimits();
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("keeps project CRUD inside the owner boundary", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);

    const project = await createProject(owner.userId, { name: "Owner library", description: "private" });
    const listed = await listProjects(owner.userId);
    expect(listed.map((row) => row.id)).toContain(project.id);
    expect(await listProjects(stranger.userId)).toEqual([]);

    await expect(getOwnedProject(stranger.userId, project.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await softDeleteProject(owner.userId, project.id);
    await expect(getOwnedProject(owner.userId, project.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("stores a valid image privately and blocks cross-user reads", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);

    const project = await createProject(owner.userId, { name: "Isolation", description: "" });
    const png = await pngBytes();
    const intent = await createUploadIntent(owner.userId, {
      projectId: project.id,
      filename: "Holiday Shot.PNG",
      mimeType: "image/png",
      byteSize: png.byteLength,
    });

    expect(intent.uploadUrl).toContain("/api/storage/objects?token=");
    expect(intent.uploadUrl.toLowerCase()).not.toContain("holiday");

    const put = await storagePut(
      new Request(`http://127.0.0.1:43127${intent.uploadUrl}`, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(png),
      }),
    );
    expect(put.status).toBe(204);

    const asset = await completeUpload(owner.userId, intent.intentId);
    expect(asset.userId).toBe(owner.userId);
    expect(asset.originalFilename).toBe("Holiday Shot.PNG");
    expect(asset.storageKey).not.toMatch(/holiday/i);
    expect(asset.storageKey).toContain(`users/${owner.userId}/assets/${asset.id}/`);

    const stored = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(stored?.userId).toBe(owner.userId);

    await expect(getOwnedAsset(stranger.userId, asset.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createDownloadUrl(stranger.userId, asset.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(completeUpload(stranger.userId, intent.intentId)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const download = await createDownloadUrl(owner.userId, asset.id);
    expect(download.expiresInSeconds).toBeGreaterThan(0);
    expect(download.expiresInSeconds).toBeLessThanOrEqual(300);
    expect(download.url.toLowerCase()).not.toContain("holiday");

    const preview = await storageGet(new Request(`http://127.0.0.1:43127${download.url}`));
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/png");
  });

  it("never creates an Asset for invalid bytes and deletes the object", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Reject", description: "" });
    const fake = Buffer.from("this is not a png");
    const intent = await createUploadIntent(owner.userId, {
      projectId: project.id,
      filename: "mask.png",
      mimeType: "image/png",
      byteSize: fake.byteLength,
    });
    await getStorage().putObject(`users/${owner.userId}/uploads/${intent.intentId}`, fake, "image/png");

    await expect(completeUpload(owner.userId, intent.intentId)).rejects.toBeInstanceOf(DomainError);
    expect(await prisma.asset.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await getStorage().getObject(`users/${owner.userId}/uploads/${intent.intentId}`)).toBeNull();
    const rejected = await prisma.uploadIntent.findUnique({ where: { id: intent.intentId } });
    expect(rejected?.status).toBe("rejected");
  });

  it("rejects oversized images before creating an Asset", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const huge = await pngBytes(8200, 8);
    const intent = await createUploadIntent(owner.userId, {
      filename: "wide.png",
      mimeType: "image/png",
      byteSize: huge.byteLength,
    });
    await getStorage().putObject(`users/${owner.userId}/uploads/${intent.intentId}`, huge, "image/png");
    await expect(completeUpload(owner.userId, intent.intentId)).rejects.toMatchObject({
      code: "VALIDATION_IMAGE_TOO_LARGE",
    });
    expect(await prisma.asset.count({ where: { userId: owner.userId } })).toBe(0);
  });

  it("rejects uploads that would exceed the storage quota", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    await prisma.userProfile.update({
      where: { userId: owner.userId },
      data: { storageUsedBytes: 1_073_741_824 },
    });
    const png = await pngBytes();
    await expect(
      createUploadIntent(owner.userId, {
        filename: "quota.png",
        mimeType: "image/png",
        byteSize: png.byteLength,
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });

  it("rejects unauthenticated and cross-user HTTP access", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);
    const project = await createProject(owner.userId, { name: "HTTP", description: "" });
    const png = await pngBytes();
    const intent = await createUploadIntent(owner.userId, {
      projectId: project.id,
      filename: "api.png",
      mimeType: "image/png",
      byteSize: png.byteLength,
    });
    await getStorage().putObject(`users/${owner.userId}/uploads/${intent.intentId}`, png, "image/png");
    const asset = await completeUpload(owner.userId, intent.intentId);

    const unauthenticated = await createIntentRoute(
      new Request("http://127.0.0.1:43127/api/uploads/intents", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          filename: "api.png",
          mimeType: "image/png",
          byteSize: 12,
        }),
      }),
    );
    expect(unauthenticated.status).toBe(401);

    const foreignIntent = await createIntentRoute(
      new Request("http://127.0.0.1:43127/api/uploads/intents", {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: stranger.cookie },
        body: JSON.stringify({
          projectId: project.id,
          filename: "steal.png",
          mimeType: "image/png",
          byteSize: png.byteLength,
        }),
      }),
    );
    expect(foreignIntent.status).toBe(404);

    const foreignComplete = await completeUploadRoute(
      new Request(`http://127.0.0.1:43127/api/uploads/intents/${intent.intentId}/complete`, {
        method: "POST",
        headers: { origin, cookie: stranger.cookie },
      }),
      { params: Promise.resolve({ id: intent.intentId }) },
    );
    expect(foreignComplete.status).toBe(404);

    const foreignDownload = await downloadRoute(
      new Request(`http://127.0.0.1:43127/api/assets/${asset.id}/download`, {
        headers: { cookie: stranger.cookie },
      }),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(foreignDownload.status).toBe(404);
    const payload = (await foreignDownload.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("NOT_FOUND");
  });

  it("rejects a declared MIME that does not match the file extension", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    await expect(
      createUploadIntent(owner.userId, {
        filename: "notes.txt",
        mimeType: "image/png",
        byteSize: 128,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_INVALID_MIME" });
  });
});
