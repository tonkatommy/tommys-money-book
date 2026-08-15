-- CreateTable
CREATE TABLE "BudgetSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "anchorDay" INTEGER NOT NULL DEFAULT 20,
    "splitFortnightly" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryBudget" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "dueDay" INTEGER,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "carryoverCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "CategoryBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryBudget_periodStart_idx" ON "CategoryBudget"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryBudget_categoryId_periodStart_key" ON "CategoryBudget"("categoryId", "periodStart");

-- AddForeignKey
ALTER TABLE "CategoryBudget" ADD CONSTRAINT "CategoryBudget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
