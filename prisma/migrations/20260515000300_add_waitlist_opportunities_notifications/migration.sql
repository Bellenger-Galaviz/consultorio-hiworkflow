CREATE TABLE "WaitlistOpportunity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceAppointmentId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "durationMin" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "offeredEntryId" TEXT,
  "offeredAt" TIMESTAMP(3),
  "bookedAppointmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WaitlistOpportunity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "target" TEXT,
  "status" TEXT NOT NULL DEFAULT 'UNREAD',
  "appointmentId" TEXT,
  "waitlistEntryId" TEXT,
  "waitlistOpportunityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChatMessage" ADD COLUMN "waitlistOpportunityId" TEXT;

CREATE INDEX "WaitlistOpportunity_userId_idx" ON "WaitlistOpportunity"("userId");
CREATE INDEX "WaitlistOpportunity_startsAt_idx" ON "WaitlistOpportunity"("startsAt");
CREATE INDEX "WaitlistOpportunity_status_idx" ON "WaitlistOpportunity"("status");
CREATE INDEX "WaitlistOpportunity_offeredEntryId_idx" ON "WaitlistOpportunity"("offeredEntryId");
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");
CREATE INDEX "Notification_status_idx" ON "Notification"("status");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
CREATE INDEX "ChatMessage_waitlistOpportunityId_idx" ON "ChatMessage"("waitlistOpportunityId");

ALTER TABLE "WaitlistOpportunity" ADD CONSTRAINT "WaitlistOpportunity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitlistOpportunity" ADD CONSTRAINT "WaitlistOpportunity_offeredEntryId_fkey" FOREIGN KEY ("offeredEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_waitlistOpportunityId_fkey" FOREIGN KEY ("waitlistOpportunityId") REFERENCES "WaitlistOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
