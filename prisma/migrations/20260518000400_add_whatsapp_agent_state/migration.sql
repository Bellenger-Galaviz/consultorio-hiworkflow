CREATE TABLE "WhatsappAgentState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "topic" TEXT NOT NULL DEFAULT 'REPROGRAM',
  "rangeStart" TEXT,
  "rangeEnd" TEXT,
  "period" TEXT,
  "offeredSlots" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsappAgentState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappAgentState_appointmentId_topic_key" ON "WhatsappAgentState"("appointmentId", "topic");
CREATE INDEX "WhatsappAgentState_userId_idx" ON "WhatsappAgentState"("userId");
CREATE INDEX "WhatsappAgentState_clientId_idx" ON "WhatsappAgentState"("clientId");

ALTER TABLE "WhatsappAgentState" ADD CONSTRAINT "WhatsappAgentState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappAgentState" ADD CONSTRAINT "WhatsappAgentState_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappAgentState" ADD CONSTRAINT "WhatsappAgentState_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
