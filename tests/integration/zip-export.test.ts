import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST as exportRoute } from "@/app/api/projects/[id]/export/route";
import { PUT as storagePut } from "@/app/api/storage/objects/route";
import { persistDerivedAsset } from "@/lib/assets/persist";
import { completeUpload, createUploadIntent } from "@/lib/assets/service";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { resetRateLimits } from "@/lib/rate-limit";
import { resetMemoryStorage } from "@/lib/storage/memory";

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

function zipEntryNames(buffer: Buffer) {
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.byteLength && buffer.readUInt32LE(offset) === 0x04034b50) {
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const size = buffer.readUInt32LE(offset + 22);
    names.push(buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + size;
  }
  return names;
}

async function createAccount() {
  const email = `phase48-zip-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Phase 4.8 zip", email, password },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
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

describe("project ZIP export", () => {
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

  it("streams owned processed assets and rejects originals and other users", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);
    const project = await createProject(owner.userId, { name: "Export", description: "" });
    const original = await uploadPng(owner.userId, project.id, "../../secret.png");
    const png = await pngBytes();
    const derived = await persistDerivedAsset({
      userId: owner.userId,
      projectId: project.id,
      kind: "DERIVATIVE",
      mimeType: "image/png",
      bytes: png,
      width: 16,
      height: 12,
      originalFilename: "../../secret.png",
      sourceAssetId: original.id,
    });

    const unauthenticated = await exportRoute(
      new Request(`http://127.0.0.1:43127/api/projects/${project.id}/export`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(unauthenticated.status).toBe(401);

    const stolen = await exportRoute(
      new Request(`http://127.0.0.1:43127/api/projects/${project.id}/export`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: stranger.cookie },
        body: JSON.stringify({ assetIds: [derived.id] }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(stolen.status).toBe(404);

    const originalOnly = await exportRoute(
      new Request(`http://127.0.0.1:43127/api/projects/${project.id}/export`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({ assetIds: [original.id] }),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(originalOnly.status).toBe(400);

    const exported = await exportRoute(
      new Request(`http://127.0.0.1:43127/api/projects/${project.id}/export`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: project.id }) },
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/zip");
    expect(exported.headers.get("content-disposition")).toContain(".zip");
    const bytes = Buffer.from(await exported.arrayBuffer());
    expect(bytes.subarray(0, 4).toString("binary")).toBe("PK\u0003\u0004");
    const names = zipEntryNames(bytes);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain(derived.id.slice(0, 8));
    expect(names[0]?.includes("..")).toBe(false);
    expect(names[0]?.includes("/")).toBe(false);
    expect(bytes.includes(Buffer.from("http://"))).toBe(false);
  });
});
