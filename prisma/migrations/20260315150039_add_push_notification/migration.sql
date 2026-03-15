/*
  Warnings:

  - You are about to drop the column `category` on the `AiDigest` table. All the data in the column will be lost.
  - You are about to drop the column `isDeleted` on the `AiDigest` table. All the data in the column will be lost.
  - You are about to drop the column `isGeneral` on the `AiDigest` table. All the data in the column will be lost.
  - You are about to drop the column `sourceUrl` on the `AiDigest` table. All the data in the column will be lost.
  - You are about to drop the column `targetTags` on the `AiDigest` table. All the data in the column will be lost.
  - You are about to drop the column `joinDate` on the `Member` table. All the data in the column will be lost.
  - You are about to drop the column `perspectives` on the `MemberPreference` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[comboKey,region,publishDate]` on the table `AiDigest` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name,groupType]` on the table `OrganizationGroup` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `comboKey` to the `AiDigest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `industries` to the `AiDigest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `interests` to the `AiDigest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `perspective` to the `AiDigest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `region` to the `AiDigest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `groupType` to the `OrganizationGroup` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OrganizationGroupType" AS ENUM ('HEAD', 'REGIONAL', 'TERM', 'COMMITTEE', 'CY', 'LOCAL');

-- CreateEnum
CREATE TYPE "ElectionType" AS ENUM ('SINGLE', 'MULTIPLE');

-- CreateEnum
CREATE TYPE "ElectionStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ElectionTarget" AS ENUM ('ALL', 'DISTRICT', 'TERM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PushTarget" ADD VALUE 'TERM';
ALTER TYPE "PushTarget" ADD VALUE 'CY_TERM';

-- DropIndex
DROP INDEX "AiDigest_isGeneral_idx";

-- DropIndex
DROP INDEX "OrganizationPosition_name_key";

-- AlterTable
ALTER TABLE "AiDigest" DROP COLUMN "category",
DROP COLUMN "isDeleted",
DROP COLUMN "isGeneral",
DROP COLUMN "sourceUrl",
DROP COLUMN "targetTags",
ADD COLUMN     "comboKey" TEXT NOT NULL,
ADD COLUMN     "industries" TEXT NOT NULL,
ADD COLUMN     "interests" TEXT NOT NULL,
ADD COLUMN     "perspective" TEXT NOT NULL,
ADD COLUMN     "region" TEXT NOT NULL,
ADD COLUMN     "sourceUrls" TEXT;

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "ecpayPayInfo" JSONB;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "address" TEXT,
ADD COLUMN     "coverImage" TEXT;

-- AlterTable
ALTER TABLE "Member" DROP COLUMN "joinDate",
ADD COLUMN     "paymentYears" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "privacySettings" TEXT,
ADD COLUMN     "resetCode" TEXT,
ADD COLUMN     "resetCodeExpiry" TIMESTAMP(3),
ALTER COLUMN "termNumber" DROP NOT NULL,
ALTER COLUMN "studentNumber" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MemberPreference" DROP COLUMN "perspectives",
ADD COLUMN     "perspective" TEXT;

-- AlterTable
ALTER TABLE "OrganizationGroup" ADD COLUMN     "groupType" "OrganizationGroupType" NOT NULL,
ADD COLUMN     "parentId" INTEGER,
ALTER COLUMN "year" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PushNotification" ADD COLUMN     "targetValue" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "RssSource" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RssSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RssArticle" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RssArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushReadStatus" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "dismissedIds" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "PushReadStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Election" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "ElectionType" NOT NULL DEFAULT 'SINGLE',
    "maxVotes" INTEGER NOT NULL DEFAULT 1,
    "status" "ElectionStatus" NOT NULL DEFAULT 'DRAFT',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "targetType" "ElectionTarget" NOT NULL DEFAULT 'ALL',
    "targetId" INTEGER,
    "requirePayment" BOOLEAN NOT NULL DEFAULT true,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Election_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" SERIAL NOT NULL,
    "electionId" INTEGER NOT NULL,
    "memberId" INTEGER,
    "name" TEXT NOT NULL,
    "number" INTEGER NOT NULL DEFAULT 0,
    "photo" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" SERIAL NOT NULL,
    "electionId" INTEGER NOT NULL,
    "candidateId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "targetId" INTEGER,
    "targetName" TEXT,
    "detail" TEXT,
    "adminId" INTEGER,
    "adminName" TEXT,
    "memberId" INTEGER,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RssSource_region_idx" ON "RssSource"("region");

-- CreateIndex
CREATE INDEX "RssSource_isActive_idx" ON "RssSource"("isActive");

-- CreateIndex
CREATE INDEX "RssArticle_sourceId_idx" ON "RssArticle"("sourceId");

-- CreateIndex
CREATE INDEX "RssArticle_publishedAt_idx" ON "RssArticle"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RssArticle_url_key" ON "RssArticle"("url");

-- CreateIndex
CREATE UNIQUE INDEX "PushReadStatus_memberId_key" ON "PushReadStatus"("memberId");

-- CreateIndex
CREATE INDEX "Election_status_idx" ON "Election"("status");

-- CreateIndex
CREATE INDEX "Election_startTime_idx" ON "Election"("startTime");

-- CreateIndex
CREATE INDEX "Candidate_electionId_idx" ON "Candidate"("electionId");

-- CreateIndex
CREATE INDEX "Vote_electionId_idx" ON "Vote"("electionId");

-- CreateIndex
CREATE INDEX "Vote_memberId_idx" ON "Vote"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_electionId_memberId_candidateId_key" ON "Vote"("electionId", "memberId", "candidateId");

-- CreateIndex
CREATE INDEX "AuditLog_module_idx" ON "AuditLog"("module");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetId_idx" ON "AuditLog"("targetId");

-- CreateIndex
CREATE INDEX "AiDigest_comboKey_idx" ON "AiDigest"("comboKey");

-- CreateIndex
CREATE INDEX "AiDigest_region_idx" ON "AiDigest"("region");

-- CreateIndex
CREATE UNIQUE INDEX "AiDigest_comboKey_region_publishDate_key" ON "AiDigest"("comboKey", "region", "publishDate");

-- CreateIndex
CREATE INDEX "Bill_batchId_status_idx" ON "Bill"("batchId", "status");

-- CreateIndex
CREATE INDEX "Bill_memberId_status_idx" ON "Bill"("memberId", "status");

-- CreateIndex
CREATE INDEX "Event_status_startTime_idx" ON "Event"("status", "startTime");

-- CreateIndex
CREATE INDEX "Event_targetType_districtId_idx" ON "Event"("targetType", "districtId");

-- CreateIndex
CREATE INDEX "OrganizationGroup_parentId_idx" ON "OrganizationGroup"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationGroup_name_groupType_key" ON "OrganizationGroup"("name", "groupType");

-- AddForeignKey
ALTER TABLE "OrganizationGroup" ADD CONSTRAINT "OrganizationGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrganizationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RssArticle" ADD CONSTRAINT "RssArticle_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RssSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushReadStatus" ADD CONSTRAINT "PushReadStatus_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
