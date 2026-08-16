-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'DIRECTOR', 'COORDINATOR', 'COACH', 'STAFF', 'MEDICAL', 'GUARDIAN', 'ATHLETE');

-- CreateEnum
CREATE TYPE "StaffDepartment" AS ENUM ('DIRECTION', 'TECHNICAL', 'CLINICAL', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "DominantSide" AS ENUM ('RIGHT', 'LEFT', 'BOTH');

-- CreateEnum
CREATE TYPE "AthleteStatus" AS ENUM ('ACTIVE', 'PAUSED', 'LEFT');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'JUSTIFIED', 'LATE');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('OPEN', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MBWAY', 'MULTIBANCO', 'CARD', 'TRANSFER', 'CASH');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PAYMENT_RECEIVED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_DUE', 'SESSION_CHANGED', 'SESSION_CANCELLED', 'ANNOUNCEMENT_PUBLISHED', 'EVALUATION_PUBLISHED');

-- CreateEnum
CREATE TYPE "ClinicalKind" AS ENUM ('INJURY', 'EXAM', 'PHYSIO', 'NUTRITION', 'PSYCHOLOGY', 'NOTE');

-- CreateEnum
CREATE TYPE "ClinicalImpact" AS ENUM ('NONE', 'LIMITED', 'OUT');

-- CreateEnum
CREATE TYPE "ClinicalStatus" AS ENUM ('DONE', 'SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'PLAYED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallUpStatus" AS ENUM ('CALLED', 'CONFIRMED', 'DECLINED');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "Academy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "city" TEXT,
    "logoUrl" TEXT,
    "appIconUrl" TEXT,
    "signalColor" TEXT NOT NULL DEFAULT '#0f6b62',
    "billingDueDay" INTEGER NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Academy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sport" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "positions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dominantSideLabel" TEXT,
    "matchMinutes" INTEGER,

    CONSTRAINT "Sport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'pt-PT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "title" TEXT,
    "department" "StaffDepartment",
    "grants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scope" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Athlete" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthdate" DATE NOT NULL,
    "photoUrl" TEXT,
    "status" "AthleteStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heightCm" INTEGER,
    "weightKg" DECIMAL(4,1),
    "dominantSide" "DominantSide",
    "squadNumber" INTEGER,
    "medicalValidUntil" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Athlete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianLink" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "isPayer" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GuardianLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ageGroup" TEXT NOT NULL,
    "schedule" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "position" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamStaff" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "TeamStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "coachId" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "attendanceClosedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "months" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12]::INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "period" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'OPEN',
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'eupago',
    "providerRef" TEXT,
    "entity" TEXT,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "signature" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "channels" TEXT[] DEFAULT ARRAY['inapp']::TEXT[],
    "readAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalEntry" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" "ClinicalKind" NOT NULL,
    "status" "ClinicalStatus" NOT NULL DEFAULT 'DONE',
    "date" DATE NOT NULL,
    "time" TEXT,
    "location" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "impact" "ClinicalImpact" NOT NULL DEFAULT 'NONE',
    "expectedReturn" DATE,
    "outDays" INTEGER,
    "clearedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL DEFAULT true,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "coachId" TEXT,
    "ourScore" INTEGER,
    "theirScore" INTEGER,
    "sourceProvider" TEXT,
    "sourceUrl" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCallUp" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "status" "CallUpStatus" NOT NULL DEFAULT 'CALLED',

    CONSTRAINT "MatchCallUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchAppearance" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "tally" INTEGER NOT NULL DEFAULT 0,
    "rating" DECIMAL(3,1),

    CONSTRAINT "MatchAppearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "scores" JSONB NOT NULL,
    "note" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Academy_slug_key" ON "Academy"("slug");

-- CreateIndex
CREATE INDEX "Sport_academyId_idx" ON "Sport"("academyId");

-- CreateIndex
CREATE UNIQUE INDEX "Sport_academyId_name_key" ON "Sport"("academyId", "name");

-- CreateIndex
CREATE INDEX "Season_academyId_idx" ON "Season"("academyId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_academyId_label_key" ON "Season"("academyId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "User_authId_key" ON "User"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_academyId_idx" ON "Membership"("academyId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_academyId_userId_role_key" ON "Membership"("academyId", "userId", "role");

-- CreateIndex
CREATE INDEX "Athlete_academyId_idx" ON "Athlete"("academyId");

-- CreateIndex
CREATE INDEX "Athlete_academyId_status_idx" ON "Athlete"("academyId", "status");

-- CreateIndex
CREATE INDEX "GuardianLink_membershipId_idx" ON "GuardianLink"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianLink_athleteId_membershipId_key" ON "GuardianLink"("athleteId", "membershipId");

-- CreateIndex
CREATE INDEX "Team_academyId_idx" ON "Team"("academyId");

-- CreateIndex
CREATE INDEX "Team_academyId_seasonId_idx" ON "Team"("academyId", "seasonId");

-- CreateIndex
CREATE INDEX "TeamMembership_athleteId_idx" ON "TeamMembership"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_teamId_athleteId_key" ON "TeamMembership"("teamId", "athleteId");

-- CreateIndex
CREATE INDEX "TeamStaff_membershipId_idx" ON "TeamStaff"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamStaff_teamId_membershipId_key" ON "TeamStaff"("teamId", "membershipId");

-- CreateIndex
CREATE INDEX "TrainingSession_academyId_startsAt_idx" ON "TrainingSession"("academyId", "startsAt");

-- CreateIndex
CREATE INDEX "TrainingSession_teamId_startsAt_idx" ON "TrainingSession"("teamId", "startsAt");

-- CreateIndex
CREATE INDEX "AttendanceRecord_athleteId_idx" ON "AttendanceRecord"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_sessionId_athleteId_key" ON "AttendanceRecord"("sessionId", "athleteId");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_academyId_idx" ON "SubscriptionPlan"("academyId");

-- CreateIndex
CREATE INDEX "Enrollment_athleteId_idx" ON "Enrollment"("athleteId");

-- CreateIndex
CREATE INDEX "Charge_academyId_period_idx" ON "Charge"("academyId", "period");

-- CreateIndex
CREATE INDEX "Charge_academyId_status_idx" ON "Charge"("academyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_athleteId_period_key" ON "Charge"("athleteId", "period");

-- CreateIndex
CREATE INDEX "Payment_chargeId_idx" ON "Payment"("chargeId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerRef_key" ON "Payment"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "Announcement_academyId_publishedAt_idx" ON "Announcement"("academyId", "publishedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_academyId_createdAt_idx" ON "Notification"("academyId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalEntry_academyId_status_idx" ON "ClinicalEntry"("academyId", "status");

-- CreateIndex
CREATE INDEX "ClinicalEntry_athleteId_date_idx" ON "ClinicalEntry"("athleteId", "date");

-- CreateIndex
CREATE INDEX "ClinicalEntry_academyId_impact_clearedOn_idx" ON "ClinicalEntry"("academyId", "impact", "clearedOn");

-- CreateIndex
CREATE INDEX "Match_academyId_startsAt_idx" ON "Match"("academyId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_teamId_startsAt_key" ON "Match"("teamId", "startsAt");

-- CreateIndex
CREATE INDEX "MatchCallUp_athleteId_idx" ON "MatchCallUp"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCallUp_matchId_athleteId_key" ON "MatchCallUp"("matchId", "athleteId");

-- CreateIndex
CREATE INDEX "MatchAppearance_athleteId_idx" ON "MatchAppearance"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchAppearance_matchId_athleteId_key" ON "MatchAppearance"("matchId", "athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Evaluation_academyId_status_idx" ON "Evaluation"("academyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_athleteId_period_key" ON "Evaluation"("athleteId", "period");

-- AddForeignKey
ALTER TABLE "Sport" ADD CONSTRAINT "Sport_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Athlete" ADD CONSTRAINT "Athlete_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamStaff" ADD CONSTRAINT "TeamStaff_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamStaff" ADD CONSTRAINT "TeamStaff_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalEntry" ADD CONSTRAINT "ClinicalEntry_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalEntry" ADD CONSTRAINT "ClinicalEntry_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalEntry" ADD CONSTRAINT "ClinicalEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCallUp" ADD CONSTRAINT "MatchCallUp_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCallUp" ADD CONSTRAINT "MatchCallUp_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchAppearance" ADD CONSTRAINT "MatchAppearance_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchAppearance" ADD CONSTRAINT "MatchAppearance_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

