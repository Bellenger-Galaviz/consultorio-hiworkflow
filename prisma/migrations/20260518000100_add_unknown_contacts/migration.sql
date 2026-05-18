CREATE TABLE "UnknownContact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "displayName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnknownContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UnknownContactMessage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "unknownContactId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "intent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnknownContactMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnknownContact_userId_phone_key" ON "UnknownContact"("userId", "phone");
CREATE INDEX "UnknownContact_userId_idx" ON "UnknownContact"("userId");
CREATE INDEX "UnknownContact_status_idx" ON "UnknownContact"("status");
CREATE INDEX "UnknownContactMessage_userId_idx" ON "UnknownContactMessage"("userId");
CREATE INDEX "UnknownContactMessage_unknownContactId_idx" ON "UnknownContactMessage"("unknownContactId");
CREATE INDEX "UnknownContactMessage_createdAt_idx" ON "UnknownContactMessage"("createdAt");

ALTER TABLE "UnknownContact" ADD CONSTRAINT "UnknownContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnknownContactMessage" ADD CONSTRAINT "UnknownContactMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnknownContactMessage" ADD CONSTRAINT "UnknownContactMessage_unknownContactId_fkey" FOREIGN KEY ("unknownContactId") REFERENCES "UnknownContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
