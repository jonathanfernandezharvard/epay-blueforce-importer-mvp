-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BatchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "siteCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "screenshotPath" TEXT,
    "createdUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedUtc" DATETIME NOT NULL,
    CONSTRAINT "BatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BatchItem" ("batchId", "createdUtc", "id", "message", "screenshotPath", "siteCode", "status", "updatedUtc") SELECT "batchId", "createdUtc", "id", "message", "screenshotPath", "siteCode", "status", "updatedUtc" FROM "BatchItem";
DROP TABLE "BatchItem";
ALTER TABLE "new_BatchItem" RENAME TO "BatchItem";
CREATE INDEX "BatchItem_batchId_idx" ON "BatchItem"("batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
