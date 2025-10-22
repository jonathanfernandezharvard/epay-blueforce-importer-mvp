-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "payrollId" TEXT NOT NULL,
    "jobsJson" TEXT NOT NULL,
    "csvPath" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('Queued','Running','Done','Error')),
    "outcome" TEXT,
    "requestedByUpn" TEXT NOT NULL,
    "idempotencyHash" TEXT NOT NULL,
    "createdUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedUtc" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BatchItem" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "batchId" TEXT NOT NULL,
    "siteCode" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('Queued','Imported','Error')),
    "message" TEXT,
    "screenshotPath" TEXT,
    "createdUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedUtc" DATETIME NOT NULL,
    CONSTRAINT "BatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Indexes
CREATE INDEX "Batch_createdUtc_idx" ON "Batch" ("createdUtc");
CREATE INDEX "Batch_idempotencyHash_idx" ON "Batch" ("idempotencyHash");
CREATE INDEX "BatchItem_batchId_idx" ON "BatchItem" ("batchId");
