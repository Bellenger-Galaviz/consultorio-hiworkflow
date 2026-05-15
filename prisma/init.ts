import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function createSchema() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "Session"`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ChatMessage"`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ReminderLog"`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "Attendance"`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "Appointment"`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "Client"`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "User"`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Session_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Client" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "fullName" TEXT NOT NULL,
      "phone" TEXT NOT NULL,
      "email" TEXT,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "Client_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Appointment" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "startsAt" DATETIME NOT NULL,
      "durationMin" INTEGER NOT NULL DEFAULT 60,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "Appointment_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "Appointment_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Attendance" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "date" DATETIME NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PRESENT',
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Attendance_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "Attendance_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ReminderLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "appointmentId" TEXT,
      "channel" TEXT NOT NULL DEFAULT 'whatsapp',
      "type" TEXT NOT NULL DEFAULT 'MANUAL',
      "message" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "response" TEXT,
      "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ReminderLog_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ReminderLog_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ReminderLog_appointmentId_fkey"
        FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ChatMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "appointmentId" TEXT,
      "direction" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "intent" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ChatMessage_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ChatMessage_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ChatMessage_appointmentId_fkey"
        FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "User_email_key" ON "User"("email")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "Session_userId_idx" ON "Session"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "Client_userId_idx" ON "Client"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "Appointment_userId_idx" ON "Appointment"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Appointment_startsAt_idx" ON "Appointment"("startsAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Appointment_clientId_idx" ON "Appointment"("clientId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "Attendance_userId_idx" ON "Attendance"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Attendance_date_idx" ON "Attendance"("date")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Attendance_clientId_idx" ON "Attendance"("clientId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "ReminderLog_userId_idx" ON "ReminderLog"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReminderLog_sentAt_idx" ON "ReminderLog"("sentAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReminderLog_clientId_idx" ON "ReminderLog"("clientId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "ChatMessage_userId_idx" ON "ChatMessage"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "ChatMessage_clientId_idx" ON "ChatMessage"("clientId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "ChatMessage_appointmentId_idx" ON "ChatMessage"("appointmentId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt")`);
}

createSchema()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
