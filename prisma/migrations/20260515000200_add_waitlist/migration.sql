CREATE TABLE "WaitlistEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "desiredDate" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "durationMin" INTEGER NOT NULL DEFAULT 60,
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "status" TEXT NOT NULL DEFAULT 'WAITING',
  "notes" TEXT,
  "offeredStartsAt" TIMESTAMP(3),
  "offeredAt" TIMESTAMP(3),
  "bookedAppointmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChatMessage" ADD COLUMN "waitlistEntryId" TEXT;

CREATE INDEX "WaitlistEntry_userId_idx" ON "WaitlistEntry"("userId");
CREATE INDEX "WaitlistEntry_clientId_idx" ON "WaitlistEntry"("clientId");
CREATE INDEX "WaitlistEntry_desiredDate_idx" ON "WaitlistEntry"("desiredDate");
CREATE INDEX "WaitlistEntry_status_idx" ON "WaitlistEntry"("status");
CREATE INDEX "ChatMessage_waitlistEntryId_idx" ON "ChatMessage"("waitlistEntryId");

ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
