-- CreateTable
CREATE TABLE "TaxYearAdjustment" (
    "fyLabel" TEXT NOT NULL,
    "rentalManagementFeeCents" INTEGER,
    "rentalMortgageInterestCents" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxYearAdjustment_pkey" PRIMARY KEY ("fyLabel")
);
