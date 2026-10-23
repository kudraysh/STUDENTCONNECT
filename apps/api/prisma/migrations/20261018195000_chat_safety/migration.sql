BEGIN;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "replyToId" INTEGER;

-- CreateTable
CREATE TABLE "MessageHidden" (
    "messageId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "MessageHidden_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateTable
CREATE TABLE "UserBlock" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "SafetyReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageHidden_userId_idx" ON "MessageHidden"("userId");

-- CreateIndex
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

-- CreateIndex
CREATE INDEX "SafetyReport_status_createdAt_idx" ON "SafetyReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SafetyReport_reporterId_createdAt_idx" ON "SafetyReport"("reporterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyReport_reporterId_clientId_key" ON "SafetyReport"("reporterId", "clientId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageHidden" ADD CONSTRAINT "MessageHidden_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageHidden" ADD CONSTRAINT "MessageHidden_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Пустое содержимое допустимо только у сообщения, удалённого у всех.
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_text_check";
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_text_check"
CHECK (("deletedAt" IS NOT NULL AND text = '') OR ("deletedAt" IS NULL AND length(btrim(text)) BETWEEN 1 AND 4000));
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_not_self" CHECK ("blockerId" <> "blockedId");
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_kind_check" CHECK (kind IN ('USER','MESSAGE','EVENT'));
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_status_check" CHECK (status IN ('OPEN','RESOLVED'));

COMMIT;
