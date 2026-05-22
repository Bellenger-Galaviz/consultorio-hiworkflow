CREATE TABLE "ClientFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'SAVED',
    "caption" TEXT,
    "savedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientFile_userId_idx" ON "ClientFile"("userId");
CREATE INDEX "ClientFile_clientId_idx" ON "ClientFile"("clientId");
CREATE INDEX "ClientFile_createdAt_idx" ON "ClientFile"("createdAt");
CREATE INDEX "ClientFile_status_idx" ON "ClientFile"("status");

ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
