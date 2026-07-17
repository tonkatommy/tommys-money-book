-- CreateEnum
CREATE TYPE "Book" AS ENUM ('PERSONAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "Kind" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'OWNER');

-- CreateEnum
CREATE TYPE "TaxTag" AS ENUM ('RENTAL_INCOME', 'RENTAL_EXPENSE', 'BIZ_INCOME', 'BIZ_EXPENSE', 'HOME_OFFICE');

-- CreateEnum
CREATE TYPE "Source" AS ENUM ('AKAHU', 'MANUAL');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "book" "Book" NOT NULL,
    "akahuId" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "book" "Book" NOT NULL,
    "kind" "Kind" NOT NULL,
    "taxTag" "TaxTag",
    "akahuNames" TEXT[],

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "payee" TEXT,
    "description" TEXT NOT NULL,
    "categoryId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "notes" TEXT,
    "source" "Source" NOT NULL DEFAULT 'AKAHU',
    "externalId" TEXT,
    "transferPairId" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_name_key" ON "Account"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Account_akahuId_key" ON "Account"("akahuId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_book_key" ON "Category"("name", "book");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "Transaction"("externalId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
