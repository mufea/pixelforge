import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { GET as getBalanceRoute } from "@/app/api/credits/route";
import { GET as getLedgerRoute } from "@/app/api/credits/ledger/route";
import { POST as createJobRoute } from "@/app/api/jobs/route";
import { PUT as storagePut } from "@/app/api/storage/objects/route";
import { persistDerivedAsset } from "@/lib/assets/persist";
import { completeUpload, createUploadIntent } from "@/lib/assets/service";
import { auth } from "@/lib/auth/auth";
import {
  getCreditBalance,
  getCreditLedger,
  grantCredits,
  releaseCredits,
  reserveCredits,
  settleCredits,
} from "@/lib/billing/service";
import { prisma } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs/queue";
import { processJob } from "@/lib/jobs/processor";
import { createGenerateJob, createUpscaleJob } from "@/lib/jobs/service";
import { createProject } from "@/lib/projects/service";
import { resetRateLimits } from "@/lib/rate-limit";
import { resetMemoryStorage } from "@/lib/storage/memory";
import sharp from "sharp";

vi.mock("@/lib/jobs/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs/queue")>();
  return {
    ...actual,
    enqueueJob: vi.fn(actual.enqueueJob),
  };
});

const password = "CorrectHorse!9";
const origin = "http://127.0.0.1:43127";

function cookieHeader(response: Response) {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (cookies.length > 0) {
    return cookies.map((part) => part.split(";")[0]).join("; ");
  }
  return response.headers.get("set-cookie")?.split(",")[0]?.split(";")[0] ?? "";
}

async function createAccount(credits = 0) {
  const email = `phase46-${randomUUID()}@pixelforge.test`;
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Phase 4.6", email, password },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  if (credits > 0) {
    await grantCredits(signedUp.user.id, credits, `test-grant:${randomUUID()}`);
  }
  return { userId: signedUp.user.id, cookie: cookieHeader(signIn) };
}

async function pngBytes(width = 16, height = 12) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 16, g: 80, b: 140 } },
  })
    .png()
    .toBuffer();
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

async function ledgerReasons(userId: string) {
  const page = await getCreditLedger(userId, { limit: 100 });
  return page.entries.map((entry) => entry.type);
}

describe("Phase 4.6 credit billing", () => {
  const userIds: string[] = [];

  afterEach(() => {
    resetMemoryStorage();
    resetRateLimits();
    resetEnvCache();
    vi.mocked(enqueueJob).mockReset();
    vi.mocked(enqueueJob).mockImplementation(async () => undefined);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("reserves, settles once, and is harmless on duplicate settlement and worker retries", async () => {
    const owner = await createAccount(30);
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Settle", description: "" });
    const job = await createGenerateJob(owner.userId, {
      operation: "GENERATE",
      projectId: project.id,
      prompt: "a billed ceramic mug",
    });
    expect(job.reservationId).toBeTruthy();
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 20,
      reservedCredits: 10,
    });

    const first = await processJob(job.id);
    expect(first.status).toBe("succeeded");
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 20,
      reservedCredits: 0,
      lifetimeConsumed: 10,
    });

    const second = await processJob(job.id);
    expect(second.outputAssetIds).toEqual(first.outputAssetIds);
    await settleCredits({ userId: owner.userId, jobId: job.id, reservationId: job.reservationId });
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 20,
      reservedCredits: 0,
      lifetimeConsumed: 10,
    });
    expect(await prisma.creditLedgerEntry.count({ where: { userId: owner.userId, reason: "settle" } })).toBe(1);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "GENERATED" } })).toBe(1);
  });

  it("rejects insufficient credits without creating a job or reservation", async () => {
    const owner = await createAccount(5);
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Broke", description: "" });
    await expect(
      createGenerateJob(owner.userId, {
        operation: "GENERATE",
        projectId: project.id,
        prompt: "should not enqueue",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS", status: 402 });
    expect(await prisma.aIJob.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await prisma.creditReservation.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await prisma.creditLedgerEntry.count({ where: { userId: owner.userId, reason: "reserve" } })).toBe(0);
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 5,
      reservedCredits: 0,
    });
  });

  it("rolls reservation and job creation back together", async () => {
    const owner = await createAccount(20);
    userIds.push(owner.userId);
    const jobId = randomUUID();
    const reservationId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await reserveCredits(
          {
            userId: owner.userId,
            credits: 10,
            jobId,
            reservationId,
            operation: "GENERATE",
          },
          tx,
        );
        await tx.aIJob.create({
          data: {
            id: jobId,
            userId: owner.userId,
            operation: "GENERATE",
            status: "queued",
            providerId: "mock",
            modelId: "mock-png",
            inputJson: { prompt: "rollback" },
            reservationId,
          },
        });
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");
    expect(await prisma.aIJob.count({ where: { id: jobId } })).toBe(0);
    expect(await prisma.creditReservation.count({ where: { id: reservationId } })).toBe(0);
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 20,
      reservedCredits: 0,
    });
  });

  it("releases terminal failures once and ignores duplicate release", async () => {
    const owner = await createAccount(20);
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Fail", description: "" });
    const job = await createGenerateJob(owner.userId, {
      operation: "GENERATE",
      projectId: project.id,
      prompt: "will fail validation at process time",
    });
    await prisma.aIJob.update({
      where: { id: job.id },
      data: { inputJson: { prompt: "" } },
    });
    const failed = await processJob(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("VALIDATION");
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 20,
      reservedCredits: 0,
    });
    await releaseCredits({ userId: owner.userId, jobId: job.id, reservationId: job.reservationId });
    const again = await processJob(job.id);
    expect(again.status).toBe("failed");
    expect(await prisma.creditLedgerEntry.count({ where: { userId: owner.userId, reason: "release" } })).toBe(1);
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 20,
      reservedCredits: 0,
      lifetimeConsumed: 0,
    });
  });

  it("cannot overspend the same balance under concurrent reservations", async () => {
    const owner = await createAccount(15);
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Race", description: "" });
    const results = await Promise.allSettled([
      createGenerateJob(owner.userId, {
        operation: "GENERATE",
        projectId: project.id,
        prompt: "concurrent one",
      }),
      createGenerateJob(owner.userId, {
        operation: "GENERATE",
        projectId: project.id,
        prompt: "concurrent two",
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "INSUFFICIENT_CREDITS" }),
    });
    const balance = await getCreditBalance(owner.userId);
    expect(balance.availableCredits).toBe(5);
    expect(balance.reservedCredits).toBe(10);
    expect(await prisma.aIJob.count({ where: { userId: owner.userId } })).toBe(1);
    expect(await prisma.creditReservation.count({ where: { userId: owner.userId } })).toBe(1);
  });

  it("charges each supported upscale factor from the shared price table", async () => {
    const owner = await createAccount(50);
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Upscale prices", description: "" });
    const original = await uploadPng(owner.userId, project.id);
    const created = [];
    for (const scaleFactor of [2, 3, 4] as const) {
      created.push(
        await createUpscaleJob(owner.userId, {
          operation: "UPSCALE",
          projectId: project.id,
          assetId: original.id,
          scaleFactor,
        }),
      );
    }
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 14,
      reservedCredits: 36,
    });
    expect(created.map((job) => job.operation)).toEqual(["UPSCALE", "UPSCALE", "UPSCALE"]);
  });

  it("keeps the hold on retryable timeouts and exhausted ambiguous failures", async () => {
    const owner = await createAccount(20);
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Timeout", description: "" });
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("aborted");
        error.name = "TimeoutError";
        throw error;
      }),
    );

    await expect(processJob(job.id)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 12,
      reservedCredits: 8,
    });
    expect((await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("queued");

    await expect(processJob(job.id)).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(processJob(job.id)).rejects.toMatchObject({ code: "TIMEOUT" });
    const exhausted = await prisma.aIJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(exhausted.status).toBe("failed");
    expect(exhausted.errorCode).toBe("TIMEOUT");
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 12,
      reservedCredits: 8,
    });
    expect(await prisma.creditReservation.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({
      status: "pending",
    });
  });

  it("reuses output without a second charge and recovers settlement after a crash", async () => {
    const owner = await createAccount(20);
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Reuse settle", description: "" });
    const job = await createGenerateJob(owner.userId, {
      operation: "GENERATE",
      projectId: project.id,
      prompt: "already produced",
    });
    const png = await pngBytes(8, 8);
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
    await prisma.aIJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        outputAssetIds: [existing.id],
      },
    });
    expect(await prisma.creditReservation.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({
      status: "pending",
    });

    const recovered = await processJob(job.id);
    expect(recovered.status).toBe("succeeded");
    expect(recovered.outputAssetIds).toEqual([existing.id]);
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 10,
      reservedCredits: 0,
      lifetimeConsumed: 10,
    });
    const replayed = await processJob(job.id);
    expect(replayed.outputAssetIds).toEqual([existing.id]);
    expect(await prisma.creditLedgerEntry.count({ where: { userId: owner.userId, reason: "settle" } })).toBe(1);
    expect(await prisma.asset.count({ where: { userId: owner.userId, kind: "GENERATED" } })).toBe(1);
  });

  it("leaves the reservation pending when queue publication fails", async () => {
    const owner = await createAccount(20);
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Queue", description: "" });
    vi.mocked(enqueueJob).mockRejectedValueOnce(new Error("redis down"));
    await expect(
      createGenerateJob(owner.userId, {
        operation: "GENERATE",
        projectId: project.id,
        prompt: "queued despite broker failure",
      }),
    ).rejects.toThrow("redis down");
    const job = await prisma.aIJob.findFirstOrThrow({ where: { userId: owner.userId } });
    expect(job.status).toBe("queued");
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 10,
      reservedCredits: 10,
    });
    const processed = await processJob(job.id);
    expect(processed.status).toBe("succeeded");
    expect(await getCreditBalance(owner.userId)).toMatchObject({
      availableCredits: 10,
      reservedCredits: 0,
      lifetimeConsumed: 10,
    });
  });

  it("rejects unauthenticated credit reads and scopes ledger history to the owner", async () => {
    const owner = await createAccount(25);
    const stranger = await createAccount(7);
    userIds.push(owner.userId, stranger.userId);
    const project = await createProject(owner.userId, { name: "Ledger", description: "" });
    await createGenerateJob(owner.userId, {
      operation: "GENERATE",
      projectId: project.id,
      prompt: "owner only ledger",
    });

    const unauthenticated = await getBalanceRoute(new Request("http://127.0.0.1:43127/api/credits"));
    expect(unauthenticated.status).toBe(401);

    const unauthenticatedLedger = await getLedgerRoute(
      new Request("http://127.0.0.1:43127/api/credits/ledger"),
    );
    expect(unauthenticatedLedger.status).toBe(401);

    const ownerBalance = await getBalanceRoute(
      new Request("http://127.0.0.1:43127/api/credits", { headers: { cookie: owner.cookie } }),
    );
    expect(ownerBalance.status).toBe(200);
    expect(await ownerBalance.json()).toEqual({
      availableCredits: 15,
      reservedCredits: 10,
    });

    const strangerBalance = await getBalanceRoute(
      new Request("http://127.0.0.1:43127/api/credits", { headers: { cookie: stranger.cookie } }),
    );
    expect(await strangerBalance.json()).toEqual({
      availableCredits: 7,
      reservedCredits: 0,
    });

    const forbiddenUserId = await getLedgerRoute(
      new Request(`http://127.0.0.1:43127/api/credits/ledger?userId=${owner.userId}`, {
        headers: { cookie: stranger.cookie },
      }),
    );
    expect(forbiddenUserId.status).toBe(400);

    const invalidLimit = await getLedgerRoute(
      new Request("http://127.0.0.1:43127/api/credits/ledger?limit=0", {
        headers: { cookie: owner.cookie },
      }),
    );
    expect(invalidLimit.status).toBe(400);

    const invalidCursor = await getLedgerRoute(
      new Request(`http://127.0.0.1:43127/api/credits/ledger?cursor=${randomUUID()}`, {
        headers: { cookie: owner.cookie },
      }),
    );
    expect(invalidCursor.status).toBe(400);

    const firstPageRes = await getLedgerRoute(
      new Request("http://127.0.0.1:43127/api/credits/ledger?limit=1", {
        headers: { cookie: owner.cookie },
      }),
    );
    expect(firstPageRes.status).toBe(200);
    const firstPage = (await firstPageRes.json()) as {
      entries: Array<{ id: string; type: string; jobId: string | null }>;
      nextCursor: string | null;
    };
    expect(firstPage.entries).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPageRes = await getLedgerRoute(
      new Request(`http://127.0.0.1:43127/api/credits/ledger?limit=1&cursor=${firstPage.nextCursor}`, {
        headers: { cookie: owner.cookie },
      }),
    );
    const secondPage = (await secondPageRes.json()) as {
      entries: Array<{ id: string; type: string }>;
    };
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.entries[0]?.id).not.toBe(firstPage.entries[0]?.id);
    const ownerIds = new Set(
      (await getCreditLedger(owner.userId, { limit: 100 })).entries.map((entry) => entry.id),
    );
    const strangerEntries = (await getCreditLedger(stranger.userId, { limit: 100 })).entries;
    expect(strangerEntries.every((entry) => !ownerIds.has(entry.id))).toBe(true);
    expect(strangerEntries.every((entry) => entry.type === "grant")).toBe(true);
  });

  it("does not enqueue an unauthenticated job and does not create billing rows", async () => {
    const owner = await createAccount(20);
    userIds.push(owner.userId);
    const project = await createProject(owner.userId, { name: "Auth job", description: "" });
    const unauthenticated = await createJobRoute(
      new Request("http://127.0.0.1:43127/api/jobs", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          operation: "GENERATE",
          projectId: project.id,
          prompt: "no session",
        }),
      }),
    );
    expect(unauthenticated.status).toBe(401);
    expect(await prisma.aIJob.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await ledgerReasons(owner.userId)).toEqual(["grant"]);
  });
});
