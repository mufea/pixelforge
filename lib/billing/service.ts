import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";

export const LEDGER_REASONS = ["reserve", "settle", "release", "grant"] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export const RESERVATION_STATUSES = ["pending", "settled", "released"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CreditBalance = {
  availableCredits: number;
  reservedCredits: number;
  lifetimeGranted: number;
  lifetimeConsumed: number;
};

export type PublicLedgerEntry = {
  id: string;
  type: LedgerReason;
  amount: number;
  delta: number;
  balanceAfter: number;
  jobId: string | null;
  reservationId: string | null;
  createdAt: string;
};

export type LedgerPage = {
  entries: PublicLedgerEntry[];
  nextCursor: string | null;
};

export type ReserveCreditsInput = {
  userId: string;
  credits: number;
  jobId: string;
  reservationId: string;
  operation: string;
};

export type ReservationRef = {
  userId: string;
  jobId: string;
  reservationId?: string | null;
};

/**
 * Accounting model: reserved credits leave `availableCredits` immediately and sit
 * in `reservedCredits` until settle (consumed) or release (returned to available).
 * A reserve ledger row is a hold, not a final charge. Settle records the charge
 * without changing available again (delta 0). Release restores available.
 */
export async function ensureCreditAccount(userId: string, db: DbClient = prisma) {
  return db.creditAccount.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      availableCredits: 0,
      reservedCredits: 0,
      lifetimeGranted: 0,
      lifetimeConsumed: 0,
    },
  });
}

export async function getCreditBalance(userId: string, db: DbClient = prisma): Promise<CreditBalance> {
  const account = await ensureCreditAccount(userId, db);
  return {
    availableCredits: account.availableCredits,
    reservedCredits: account.reservedCredits,
    lifetimeGranted: account.lifetimeGranted,
    lifetimeConsumed: account.lifetimeConsumed,
  };
}

export async function getCreditLedger(
  userId: string,
  input: { limit?: number; cursor?: string | null } = {},
  db: DbClient = prisma,
): Promise<LedgerPage> {
  const limit = parseLedgerLimit(input.limit);
  const cursor = input.cursor?.trim() || null;
  const where: Prisma.CreditLedgerEntryWhereInput = { userId };

  if (cursor) {
    const cursorRow = await db.creditLedgerEntry.findFirst({
      where: { id: cursor, userId },
      select: { id: true, createdAt: true },
    });
    if (!cursorRow) {
      throw new DomainError("VALIDATION", "Invalid pagination cursor");
    }
    where.OR = [
      { createdAt: { lt: cursorRow.createdAt } },
      { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
    ];
  }

  const rows = await db.creditLedgerEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    entries: page.map(publicLedgerEntry),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function grantCredits(
  userId: string,
  credits: number,
  idempotencyKey: string,
  db: DbClient = prisma,
) {
  assertPositiveCredits(credits);
  if (!idempotencyKey.trim()) {
    throw new DomainError("VALIDATION", "A grant idempotency key is required");
  }

  const existing = await db.creditLedgerEntry.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    if (existing.userId !== userId || existing.reason !== "grant" || existing.amount !== credits) {
      throw new DomainError("CONFLICT", "Idempotency key already used for a different grant", 409);
    }
    return getCreditBalance(userId, db);
  }

  const run = async (tx: Prisma.TransactionClient) => {
    const account = await lockAccount(tx, userId);
    const updated = await tx.creditAccount.update({
      where: { id: account.id },
      data: {
        availableCredits: { increment: credits },
        lifetimeGranted: { increment: credits },
        version: { increment: 1 },
      },
    });
    await tx.creditLedgerEntry.create({
      data: {
        userId,
        accountId: account.id,
        amount: credits,
        delta: credits,
        balanceAfter: updated.availableCredits,
        reason: "grant",
        idempotencyKey,
      },
    });
    return {
      availableCredits: updated.availableCredits,
      reservedCredits: updated.reservedCredits,
      lifetimeGranted: updated.lifetimeGranted,
      lifetimeConsumed: updated.lifetimeConsumed,
    };
  };

  try {
    return await runInDb(db, run);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return getCreditBalance(userId, db);
    }
    throw error;
  }
}

export async function reserveCredits(input: ReserveCreditsInput, db: DbClient = prisma) {
  assertPositiveCredits(input.credits);
  const run = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.creditReservation.findUnique({
      where: { jobId: input.jobId },
    });
    if (existing) {
      if (existing.userId !== input.userId || existing.credits !== input.credits) {
        throw new DomainError("CONFLICT", "A reservation already exists for this job", 409);
      }
      return existing;
    }

    const account = await lockAccount(tx, input.userId);
    const deducted = await tx.creditAccount.updateMany({
      where: {
        id: account.id,
        availableCredits: { gte: input.credits },
      },
      data: {
        availableCredits: { decrement: input.credits },
        reservedCredits: { increment: input.credits },
        version: { increment: 1 },
      },
    });
    if (deducted.count !== 1) {
      throw new DomainError("INSUFFICIENT_CREDITS", "Not enough credits for this operation", 402);
    }
    const updated = await tx.creditAccount.findUniqueOrThrow({ where: { id: account.id } });
    const reservation = await tx.creditReservation.create({
      data: {
        id: input.reservationId,
        userId: input.userId,
        accountId: account.id,
        jobId: input.jobId,
        credits: input.credits,
        status: "pending",
      },
    });
    await tx.creditLedgerEntry.create({
      data: {
        userId: input.userId,
        accountId: account.id,
        reservationId: reservation.id,
        jobId: input.jobId,
        amount: input.credits,
        delta: -input.credits,
        balanceAfter: updated.availableCredits,
        reason: "reserve",
        idempotencyKey: reserveIdempotencyKey(input.jobId),
        metadataJson: { operation: input.operation },
      },
    });
    return reservation;
  };

  return runInDb(db, run);
}

export async function settleCredits(input: ReservationRef, db: DbClient = prisma) {
  if (!input.reservationId && !input.jobId) {
    return null;
  }
  const run = async (tx: Prisma.TransactionClient) => {
    const reservation = await findReservation(tx, input);
    if (!reservation) {
      return null;
    }
    if (reservation.userId !== input.userId) {
      throw new DomainError("NOT_FOUND", "Reservation not found", 404);
    }
    if (reservation.status === "settled") {
      return reservation;
    }
    if (reservation.status === "released") {
      throw new DomainError("CONFLICT", "Cannot settle a released reservation", 409);
    }

    const settled = await tx.creditReservation.updateMany({
      where: { id: reservation.id, status: "pending" },
      data: { status: "settled", settledAt: new Date() },
    });
    if (settled.count !== 1) {
      const current = await tx.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      if (current.status === "settled") {
        return current;
      }
      throw new DomainError("CONFLICT", "Cannot settle a released reservation", 409);
    }

    await tx.creditAccount.updateMany({
      where: {
        id: reservation.accountId,
        reservedCredits: { gte: reservation.credits },
      },
      data: {
        reservedCredits: { decrement: reservation.credits },
        lifetimeConsumed: { increment: reservation.credits },
        version: { increment: 1 },
      },
    });
    const account = await tx.creditAccount.findUniqueOrThrow({ where: { id: reservation.accountId } });
    try {
      await tx.creditLedgerEntry.create({
        data: {
          userId: reservation.userId,
          accountId: reservation.accountId,
          reservationId: reservation.id,
          jobId: reservation.jobId,
          amount: reservation.credits,
          delta: 0,
          balanceAfter: account.availableCredits,
          reason: "settle",
          idempotencyKey: settleIdempotencyKey(reservation.id),
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
    return tx.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } });
  };

  return runInDb(db, run);
}

export async function releaseCredits(input: ReservationRef, db: DbClient = prisma) {
  if (!input.reservationId && !input.jobId) {
    return null;
  }
  const run = async (tx: Prisma.TransactionClient) => {
    const reservation = await findReservation(tx, input);
    if (!reservation) {
      return null;
    }
    if (reservation.userId !== input.userId) {
      throw new DomainError("NOT_FOUND", "Reservation not found", 404);
    }
    if (reservation.status === "released") {
      return reservation;
    }
    if (reservation.status === "settled") {
      throw new DomainError("CONFLICT", "Cannot release a settled reservation", 409);
    }

    const released = await tx.creditReservation.updateMany({
      where: { id: reservation.id, status: "pending" },
      data: { status: "released", releasedAt: new Date() },
    });
    if (released.count !== 1) {
      const current = await tx.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      if (current.status === "released") {
        return current;
      }
      throw new DomainError("CONFLICT", "Cannot release a settled reservation", 409);
    }

    await tx.creditAccount.updateMany({
      where: {
        id: reservation.accountId,
        reservedCredits: { gte: reservation.credits },
      },
      data: {
        availableCredits: { increment: reservation.credits },
        reservedCredits: { decrement: reservation.credits },
        version: { increment: 1 },
      },
    });
    const account = await tx.creditAccount.findUniqueOrThrow({ where: { id: reservation.accountId } });
    try {
      await tx.creditLedgerEntry.create({
        data: {
          userId: reservation.userId,
          accountId: reservation.accountId,
          reservationId: reservation.id,
          jobId: reservation.jobId,
          amount: reservation.credits,
          delta: reservation.credits,
          balanceAfter: account.availableCredits,
          reason: "release",
          idempotencyKey: releaseIdempotencyKey(reservation.id),
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
    return tx.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } });
  };

  return runInDb(db, run);
}

export function reserveIdempotencyKey(jobId: string) {
  return `reserve:${jobId}`;
}

export function settleIdempotencyKey(reservationId: string) {
  return `settle:${reservationId}`;
}

export function releaseIdempotencyKey(reservationId: string) {
  return `release:${reservationId}`;
}

export function parseLedgerLimit(value: unknown, fallback = 20) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new DomainError("VALIDATION", "limit must be an integer between 1 and 100");
  }
  return parsed;
}

async function lockAccount(tx: Prisma.TransactionClient, userId: string) {
  await ensureCreditAccount(userId, tx);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "CreditAccount" WHERE "userId" = ${userId} FOR UPDATE
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new DomainError("NOT_FOUND", "Credit account not found", 404);
  }
  return tx.creditAccount.findUniqueOrThrow({ where: { id } });
}

async function findReservation(tx: Prisma.TransactionClient, input: ReservationRef) {
  if (input.reservationId) {
    return tx.creditReservation.findUnique({ where: { id: input.reservationId } });
  }
  return tx.creditReservation.findUnique({ where: { jobId: input.jobId } });
}

function publicLedgerEntry(row: {
  id: string;
  reason: string;
  amount: number;
  delta: number;
  balanceAfter: number;
  jobId: string | null;
  reservationId: string | null;
  createdAt: Date;
}): PublicLedgerEntry {
  return {
    id: row.id,
    type: row.reason as LedgerReason,
    amount: row.amount,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    jobId: row.jobId,
    reservationId: row.reservationId,
    createdAt: row.createdAt.toISOString(),
  };
}

function assertPositiveCredits(credits: number) {
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new DomainError("VALIDATION", "Credit amount must be a positive integer");
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function runInDb<T>(db: DbClient, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if ("$transaction" in db) {
    return db.$transaction(run);
  }
  return run(db);
}
