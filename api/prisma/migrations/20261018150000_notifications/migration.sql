CREATE TABLE "Notification" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "message" TEXT NOT NULL, "conversationId" TEXT NOT NULL,
 "messageId" INTEGER, "isRead" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Notification_userId_isRead_createdAt_id_idx" ON "Notification"("userId", "isRead", "createdAt", "id");
CREATE INDEX "Notification_userId_conversationId_messageId_idx" ON "Notification"("userId", "conversationId", "messageId");
