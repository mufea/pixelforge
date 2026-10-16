import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { GET as getJobRoute } from "@/app/api/jobs/[id]/route";
import { POST as createJobRoute } from "@/app/api/jobs/route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { persistDerivedAsset } from "@/lib/assets/persist";
import { createGenerateJob, getOwnedJob } from "@/lib/jobs/service";
import { processJob } from "@/lib/jobs/processor";
import { createProject } from "@/lib/projects/service";
import { resetRateLimits } from "@/lib/rate-limit";
import { resetMemoryStorage } from "@/lib/storage/memory";

const password = "CorrectHorse!9";
const origin = "http://127.0.0.1:43127";

function cookieHeader(response: Response) {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (cookies.length > 0) {
    return cookies.map((part) => part.split(";")[0]).join("; ");
  }
  return response.headers.get("set-cookie")?.split(",")[0]?.split(";")[0] ?? "";
}

async function createAccount() {
  const email = `phase3-job-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Job User", email, password },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return { userId: signedUp.user.id, cookie: cookieHeader(signIn) };
}

describe("AI generate jobs", () => {
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

  it("runs a mock generate job once and stores a private asset", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Jobs", description: "" });
    const job = await createGenerateJob(owner.userId, {
      operation: "GENERATE",
      projectId: project.id,
      prompt: "a ceramic mug on slate",
    });
    expect(job.status).toBe("queued");
    expect(job.providerId).toBe("mock");

    const first = await processJob(job.id);
    expect(first.status).toBe("succeeded");
    expect(first.outputAssetIds).toHaveLength(1);

    const second = await processJob(job.id);
    expect(second.outputAssetIds).toEqual(first.outputAssetIds);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "GENERATED" } })).toBe(1);

    const asset = await prisma.asset.findUnique({ where: { id: first.outputAssetIds[0] } });
    expect(asset?.userId).toBe(owner.userId);
    expect(asset?.projectId).toBe(project.id);
    expect(asset?.kind).toBe("GENERATED");
  });

  it("hides jobs from other users and rejects invalid prompts", async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    userIds.push(owner.userId, stranger.userId);
    const project = await createProject(owner.userId, { name: "Secret", description: "" });
    const job = await createGenerateJob(owner.userId, {
      operation: "GENERATE",
      projectId: project.id,
      prompt: "private generation",
    });

    await expect(getOwnedJob(stranger.userId, job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stolen = await getJobRoute(
      new Request(`http://127.0.0.1:43127/api/jobs/${job.id}`, { headers: { cookie: stranger.cookie } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(stolen.status).toBe(404);

    const unauthenticated = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ operation: "GENERATE", projectId: project.id, prompt: "nope" }),
      }),
    );
    expect(unauthenticated.status).toBe(401);

    await expect(
      createGenerateJob(owner.userId, { operation: "GENERATE", projectId: project.id, prompt: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("marks validation failures as failed without creating an asset", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Bad", description: "" });
    const job = await prisma.aIJob.create({
      data: {
        userId: owner.userId,
        projectId: project.id,
        operation: "GENERATE",
        status: "queued",
        providerId: "mock",
        modelId: "mock-png",
        inputJson: { prompt: "" },
      },
    });
    const processed = await processJob(job.id);
    expect(processed.status).toBe("failed");
    expect(processed.errorCode).toBe("VALIDATION");
    expect(await prisma.asset.count({ where: { userId: owner.userId } })).toBe(0);
  });

  it("does not call the provider again when an output asset already exists", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Reuse", description: "" });
    const job = await createGenerateJob(owner.userId, {
      operation: "GENERATE",
      projectId: project.id,
      prompt: "already billed",
    });
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const existing = await persistDerivedAsset({
      userId: owner.userId,
      projectId: project.id,
      kind: "GENERATED",
      mimeType: "image/png",
      bytes: png,
      width: 8,
      height: 8,
      originalFilename: "generated.png",
      sourceJobId: job.id,
    });

    const processed = await processJob(job.id);
    expect(processed.status).toBe("succeeded");
    expect(processed.outputAssetIds).toEqual([existing.id]);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "GENERATED" } })).toBe(1);
  });

  it("claims a queued job once under concurrent processors", async () => {
    const owner = await createAccount();
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Race", description: "" });
    const job = await createGenerateJob(owner.userId, {
      operation: "GENERATE",
      projectId: project.id,
      prompt: "concurrent claim",
    });

    const [first, second] = await Promise.all([processJob(job.id), processJob(job.id)]);
    expect([first.status, second.status].every((status) => status === "succeeded" || status === "processing")).toBe(
      true,
    );
    expect([first.status, second.status].includes("succeeded")).toBe(true);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "GENERATED" } })).toBe(1);
  });
});
