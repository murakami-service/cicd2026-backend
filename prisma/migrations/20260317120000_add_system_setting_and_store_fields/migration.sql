-- CreateTable
CREATE TABLE IF NOT EXISTS "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- AlterTable Store (add new fields if not exist)
DO $$ BEGIN
    ALTER TABLE "Store" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Store" ADD COLUMN "website" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Store" ADD COLUMN "promoUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Store" ADD COLUMN "promoDescription" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Store" ADD COLUMN "promoStartDate" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Store" ADD COLUMN "promoEndDate" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- AlterTable StoreOffer (add new fields if not exist)
DO $$ BEGIN
    ALTER TABLE "StoreOffer" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "StoreOffer" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
