/*
  Warnings:

  - You are about to drop the column `akahuNames` on the `Category` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "RuleField" AS ENUM ('AKAHU_CATEGORY', 'MERCHANT', 'DESCRIPTION');

-- CreateEnum
CREATE TYPE "RuleDirection" AS ENUM ('IN', 'OUT', 'ANY');

-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('RULE', 'MANUAL', 'TRANSFER');

-- AlterEnum
ALTER TYPE "TaxTag" ADD VALUE 'TAXABLE_INCOME';

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "akahuNames";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "categorisedAt" TIMESTAMP(3),
ADD COLUMN     "categorySource" "CategorySource";

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "field" "RuleField" NOT NULL,
    "pattern" TEXT NOT NULL,
    "accountId" TEXT,
    "direction" "RuleDirection" NOT NULL DEFAULT 'ANY',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "note" TEXT,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryRule_field_pattern_idx" ON "CategoryRule"("field", "pattern");

-- CreateIndex
CREATE INDEX "CategoryRule_categoryId_idx" ON "CategoryRule"("categoryId");

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
