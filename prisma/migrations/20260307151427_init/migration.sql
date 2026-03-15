-- CreateEnum
CREATE TYPE "MemberType" AS ENUM ('GENERAL', 'CY');

-- CreateEnum
CREATE TYPE "DistrictType" AS ENUM ('REGIONAL', 'SPECIAL');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER', 'DISTRICT', 'TERM', 'SPECIAL', 'CY_TERM');

-- CreateEnum
CREATE TYPE "BillingTargetType" AS ENUM ('GENERAL', 'DISTRICT', 'TERM', 'SPECIAL', 'CY');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('ANNUAL', 'ENROLLMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('UNPAID', 'PAID', 'MANUAL', 'OVERDUE', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ECPAY', 'BANK', 'CASH', 'CHECK');

-- CreateEnum
CREATE TYPE "EventTargetType" AS ENUM ('GENERAL', 'DISTRICT', 'TERM', 'SPECIAL', 'CY');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ONGOING', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('SELECT', 'TEXT', 'NUMBER', 'DATE', 'IMAGE', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('REGISTERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PointType" AS ENUM ('CHECKIN', 'MANUAL', 'REDEEM');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "NewsCategory" AS ENUM ('EVENT', 'ANNOUNCE', 'INDUSTRY');

-- CreateEnum
CREATE TYPE "PushTarget" AS ENUM ('ALL', 'EVENT', 'DISTRICT', 'MEMBER');

-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SCHEDULED');

-- CreateTable
CREATE TABLE "Member" (
    "id" SERIAL NOT NULL,
    "account" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "avatar" TEXT,
    "birthday" TIMESTAMP(3),
    "company" TEXT,
    "industry" TEXT,
    "address" TEXT,
    "joinDate" TIMESTAMP(3),
    "memberType" "MemberType" NOT NULL DEFAULT 'GENERAL',
    "termNumber" INTEGER NOT NULL,
    "studentNumber" INTEGER NOT NULL,
    "districtId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DistrictType" NOT NULL DEFAULT 'REGIONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberSpecialDistrict" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "districtId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberSpecialDistrict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'DISTRICT',
    "districtId" INTEGER,
    "termNumber" INTEGER,
    "memberType" "MemberType",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationPosition" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberOrganizationRole" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "positionId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberOrganizationRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingBatch" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "billingType" "BillingType" NOT NULL DEFAULT 'ANNUAL',
    "targetType" "BillingTargetType" NOT NULL,
    "districtId" INTEGER,
    "termNumber" INTEGER,
    "memberType" "MemberType",
    "note" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentMethod" "PaymentMethod",
    "paymentDate" TIMESTAMP(3),
    "bankAccount" TEXT,
    "transferTime" TIMESTAMP(3),
    "receiptUrl" TEXT,
    "operatorName" TEXT,
    "isCrossDistrict" BOOLEAN NOT NULL DEFAULT false,
    "targetDistrictId" INTEGER,
    "note" TEXT,
    "ecpayTradeNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetType" "EventTargetType" NOT NULL,
    "districtId" INTEGER,
    "termNumber" INTEGER,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "location" TEXT,
    "maxParticipants" INTEGER,
    "registrationDeadline" TIMESTAMP(3),
    "requirePayment" BOOLEAN NOT NULL DEFAULT false,
    "isFreeOpen" BOOLEAN NOT NULL DEFAULT false,
    "allowCrossDistrict" BOOLEAN NOT NULL DEFAULT false,
    "points" INTEGER NOT NULL DEFAULT 0,
    "qrCode" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventFormField" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" "FormFieldType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventFormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistration" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistrationAnswer" (
    "id" SERIAL NOT NULL,
    "registrationId" INTEGER NOT NULL,
    "fieldId" INTEGER NOT NULL,
    "answer" TEXT NOT NULL,

    CONSTRAINT "EventRegistrationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventHighlight" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkin" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "checkinAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checkin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointRecord" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "type" "PointType" NOT NULL,
    "source" TEXT,
    "eventId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedeemProduct" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "pointCost" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "redeemCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedeemProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointRedemption" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoTag" (
    "id" SERIAL NOT NULL,
    "photoId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,

    CONSTRAINT "PhotoTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" SERIAL NOT NULL,
    "followerId" INTEGER NOT NULL,
    "followingId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberPreference" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "interests" TEXT,
    "industries" TEXT,
    "perspectives" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDigest" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "category" TEXT,
    "isGeneral" BOOLEAN NOT NULL DEFAULT false,
    "targetTags" TEXT,
    "publishDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDigest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "News" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "NewsCategory" NOT NULL,
    "imageUrl" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOffer" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "extraInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushNotification" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "targetType" "PushTarget" NOT NULL,
    "targetId" INTEGER,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "status" "PushStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_account_key" ON "Member"("account");

-- CreateIndex
CREATE INDEX "Member_districtId_idx" ON "Member"("districtId");

-- CreateIndex
CREATE INDEX "Member_termNumber_idx" ON "Member"("termNumber");

-- CreateIndex
CREATE INDEX "Member_memberType_idx" ON "Member"("memberType");

-- CreateIndex
CREATE INDEX "Member_name_idx" ON "Member"("name");

-- CreateIndex
CREATE INDEX "Member_company_idx" ON "Member"("company");

-- CreateIndex
CREATE INDEX "Member_industry_idx" ON "Member"("industry");

-- CreateIndex
CREATE UNIQUE INDEX "District_name_key" ON "District"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MemberSpecialDistrict_memberId_districtId_key" ON "MemberSpecialDistrict"("memberId", "districtId");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_username_key" ON "Admin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationPosition_name_key" ON "OrganizationPosition"("name");

-- CreateIndex
CREATE INDEX "MemberOrganizationRole_memberId_idx" ON "MemberOrganizationRole"("memberId");

-- CreateIndex
CREATE INDEX "MemberOrganizationRole_year_idx" ON "MemberOrganizationRole"("year");

-- CreateIndex
CREATE INDEX "BillingBatch_targetType_idx" ON "BillingBatch"("targetType");

-- CreateIndex
CREATE INDEX "BillingBatch_status_idx" ON "BillingBatch"("status");

-- CreateIndex
CREATE INDEX "Bill_batchId_idx" ON "Bill"("batchId");

-- CreateIndex
CREATE INDEX "Bill_memberId_idx" ON "Bill"("memberId");

-- CreateIndex
CREATE INDEX "Bill_status_idx" ON "Bill"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Event_qrCode_key" ON "Event"("qrCode");

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- CreateIndex
CREATE INDEX "Event_startTime_idx" ON "Event"("startTime");

-- CreateIndex
CREATE INDEX "EventFormField_eventId_idx" ON "EventFormField"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistration_eventId_memberId_key" ON "EventRegistration"("eventId", "memberId");

-- CreateIndex
CREATE INDEX "EventRegistrationAnswer_registrationId_idx" ON "EventRegistrationAnswer"("registrationId");

-- CreateIndex
CREATE INDEX "EventHighlight_eventId_idx" ON "EventHighlight"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Checkin_eventId_memberId_key" ON "Checkin"("eventId", "memberId");

-- CreateIndex
CREATE INDEX "PointRecord_memberId_idx" ON "PointRecord"("memberId");

-- CreateIndex
CREATE INDEX "PointRecord_eventId_idx" ON "PointRecord"("eventId");

-- CreateIndex
CREATE INDEX "PointRecord_expiresAt_idx" ON "PointRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_name_key" ON "ProductCategory"("name");

-- CreateIndex
CREATE INDEX "RedeemProduct_categoryId_idx" ON "RedeemProduct"("categoryId");

-- CreateIndex
CREATE INDEX "RedeemProduct_status_idx" ON "RedeemProduct"("status");

-- CreateIndex
CREATE INDEX "RedeemProduct_sortOrder_idx" ON "RedeemProduct"("sortOrder");

-- CreateIndex
CREATE INDEX "PointRedemption_memberId_idx" ON "PointRedemption"("memberId");

-- CreateIndex
CREATE INDEX "Photo_memberId_idx" ON "Photo"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoTag_photoId_memberId_key" ON "PhotoTag"("photoId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberPreference_memberId_key" ON "MemberPreference"("memberId");

-- CreateIndex
CREATE INDEX "AiDigest_publishDate_idx" ON "AiDigest"("publishDate");

-- CreateIndex
CREATE INDEX "AiDigest_isGeneral_idx" ON "AiDigest"("isGeneral");

-- CreateIndex
CREATE INDEX "News_category_idx" ON "News"("category");

-- CreateIndex
CREATE INDEX "News_createdAt_idx" ON "News"("createdAt");

-- CreateIndex
CREATE INDEX "News_isDeleted_idx" ON "News"("isDeleted");

-- CreateIndex
CREATE INDEX "Ad_startDate_endDate_idx" ON "Ad"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Store_memberId_idx" ON "Store"("memberId");

-- CreateIndex
CREATE INDEX "Store_name_idx" ON "Store"("name");

-- CreateIndex
CREATE INDEX "Store_address_idx" ON "Store"("address");

-- CreateIndex
CREATE INDEX "StoreOffer_storeId_idx" ON "StoreOffer"("storeId");

-- CreateIndex
CREATE INDEX "PushNotification_status_idx" ON "PushNotification"("status");

-- CreateIndex
CREATE INDEX "PushNotification_scheduledAt_idx" ON "PushNotification"("scheduledAt");

-- CreateIndex
CREATE INDEX "PushToken_memberId_idx" ON "PushToken"("memberId");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSpecialDistrict" ADD CONSTRAINT "MemberSpecialDistrict_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSpecialDistrict" ADD CONSTRAINT "MemberSpecialDistrict_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberOrganizationRole" ADD CONSTRAINT "MemberOrganizationRole_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberOrganizationRole" ADD CONSTRAINT "MemberOrganizationRole_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrganizationGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberOrganizationRole" ADD CONSTRAINT "MemberOrganizationRole_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrganizationPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingBatch" ADD CONSTRAINT "BillingBatch_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingBatch" ADD CONSTRAINT "BillingBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BillingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFormField" ADD CONSTRAINT "EventFormField_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationAnswer" ADD CONSTRAINT "EventRegistrationAnswer_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationAnswer" ADD CONSTRAINT "EventRegistrationAnswer_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "EventFormField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventHighlight" ADD CONSTRAINT "EventHighlight_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkin" ADD CONSTRAINT "Checkin_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkin" ADD CONSTRAINT "Checkin_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRecord" ADD CONSTRAINT "PointRecord_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRecord" ADD CONSTRAINT "PointRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemProduct" ADD CONSTRAINT "RedeemProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRedemption" ADD CONSTRAINT "PointRedemption_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointRedemption" ADD CONSTRAINT "PointRedemption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "RedeemProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPreference" ADD CONSTRAINT "MemberPreference_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOffer" ADD CONSTRAINT "StoreOffer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
