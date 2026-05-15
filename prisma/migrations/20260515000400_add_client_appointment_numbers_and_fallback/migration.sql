ALTER TABLE "Appointment" ADD COLUMN "clientAppointmentNumber" INTEGER;
ALTER TABLE "WaitlistEntry" ADD COLUMN "fallbackAppointmentId" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN "clientAppointmentNumber" INTEGER;

WITH numbered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "clientId"
      ORDER BY "startsAt" ASC, "createdAt" ASC, "id" ASC
    ) AS sequence
  FROM "Appointment"
)
UPDATE "Appointment"
SET "clientAppointmentNumber" = numbered.sequence
FROM numbered
WHERE "Appointment"."id" = numbered."id";

CREATE UNIQUE INDEX "Appointment_clientId_clientAppointmentNumber_key" ON "Appointment"("clientId", "clientAppointmentNumber");
CREATE INDEX "WaitlistEntry_fallbackAppointmentId_idx" ON "WaitlistEntry"("fallbackAppointmentId");

ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_fallbackAppointmentId_fkey" FOREIGN KEY ("fallbackAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
