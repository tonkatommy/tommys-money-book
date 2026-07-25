-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('BASELINE', 'SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "accountType" TEXT,
ADD COLUMN     "akahuName" TEXT,
ADD COLUMN     "balanceAsAt" TIMESTAMP(3),
ADD COLUMN     "balanceCents" INTEGER,
ADD COLUMN     "connectionName" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NZD',
ADD COLUMN     "formattedAccount" TEXT,
ADD COLUMN     "historyStartDate" DATE,
ADD COLUMN     "lastTransactionAt" TIMESTAMP(3),
ADD COLUMN     "openingBalanceCents" INTEGER,
ADD COLUMN     "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "book" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "akahuCategoryGroup" TEXT,
ADD COLUMN     "akahuCategoryName" TEXT,
ADD COLUMN     "akahuType" TEXT,
ADD COLUMN     "balanceAfterCents" INTEGER,
ADD COLUMN     "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "merchantName" TEXT,
ADD COLUMN     "raw" JSONB;

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSyncResult" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "akahuBalanceCents" INTEGER,
    "computedBalanceCents" INTEGER,
    "driftCents" INTEGER,
    "error" TEXT,

    CONSTRAINT "AccountSyncResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "AccountSyncResult_accountId_idx" ON "AccountSyncResult"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSyncResult_syncRunId_accountId_key" ON "AccountSyncResult"("syncRunId", "accountId");

-- AddForeignKey
ALTER TABLE "AccountSyncResult" ADD CONSTRAINT "AccountSyncResult_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSyncResult" ADD CONSTRAINT "AccountSyncResult_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
