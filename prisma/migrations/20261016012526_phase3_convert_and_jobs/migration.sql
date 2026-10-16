-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "sourceAssetId" TEXT,
ADD COLUMN     "sourceJobId" TEXT;

-- CreateTable
CREATE TABLE "AIJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "outputAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reservationId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "timeoutAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIJobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIJobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AIJob_idempotencyKey_key" ON "AIJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AIJob_userId_createdAt_idx" ON "AIJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIJob_status_createdAt_idx" ON "AIJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AIJob_providerId_createdAt_idx" ON "AIJob"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "AIJob_projectId_idx" ON "AIJob"("projectId");

-- CreateIndex
CREATE INDEX "AIJobEvent_jobId_createdAt_idx" ON "AIJobEvent"("jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJobEvent" ADD CONSTRAINT "AIJobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AIJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
