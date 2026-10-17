import { isRetryableProviderCode } from "@/lib/ai/errors";
import { releaseCredits, settleCredits } from "@/lib/billing/service";
import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type JobCreditState = {
  id: string;
  userId: string;
  status: string;
  reservationId: string | null;
  errorCode: string | null;
};

/**
 * Idempotent billing follow-up for a job's current status.
 * Retryable / ambiguous provider codes keep the reservation even if the job
 * row is already `failed` after the existing attempt cap.
 */
export async function reconcileJobCredits(job: JobCreditState, db?: DbClient) {
  if (!job.reservationId) {
    return;
  }
  const ref = { userId: job.userId, jobId: job.id, reservationId: job.reservationId };
  const client = db ?? prisma;
  if (job.status === "succeeded") {
    await settleCredits(ref, client);
    return;
  }
  if (job.status === "cancelled") {
    await releaseCredits(ref, client);
    return;
  }
  if (job.status === "failed" && job.errorCode && !isRetryableProviderCode(job.errorCode)) {
    await releaseCredits(ref, client);
  }
}

export function shouldReleaseCreditsForFailure(code: string) {
  return !isRetryableProviderCode(code);
}
