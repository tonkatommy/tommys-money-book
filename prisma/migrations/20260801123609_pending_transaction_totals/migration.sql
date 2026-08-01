-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "pendingTotalCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AccountSyncResult" ADD COLUMN     "pendingTotalCents" INTEGER,
ADD COLUMN     "settledBalanceCents" INTEGER;
