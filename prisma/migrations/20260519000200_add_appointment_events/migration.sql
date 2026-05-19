CREATE TABLE "AppointmentEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppointmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppointmentEvent_userId_idx" ON "AppointmentEvent"("userId");
CREATE INDEX "AppointmentEvent_appointmentId_idx" ON "AppointmentEvent"("appointmentId");
CREATE INDEX "AppointmentEvent_createdAt_idx" ON "AppointmentEvent"("createdAt");

ALTER TABLE "AppointmentEvent" ADD CONSTRAINT "AppointmentEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentEvent" ADD CONSTRAINT "AppointmentEvent_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AppointmentEvent" ("id", "userId", "appointmentId", "type", "label", "createdAt")
SELECT
  'evt_' || "id",
  "userId",
  "id",
  'CREATED',
  'Creada',
  "createdAt"
FROM "Appointment";

