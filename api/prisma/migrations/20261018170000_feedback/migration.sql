CREATE TABLE "FeedbackReport" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
 "area" TEXT NOT NULL, "title" TEXT NOT NULL, "steps" TEXT NOT NULL,
 "expected" TEXT NOT NULL, "actual" TEXT NOT NULL, "page" TEXT NOT NULL,
 "environment" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'OPEN',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "FeedbackReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "FeedbackReport_status_check" CHECK (status IN ('OPEN','RESOLVED')),
 CONSTRAINT "FeedbackReport_area_check" CHECK (area IN ('PEOPLE','FEED','EVENTS','MESSAGES','PHONE','PROFILE','NOTIFICATIONS','OTHER'))
);
CREATE UNIQUE INDEX "FeedbackReport_userId_clientId_key" ON "FeedbackReport"("userId", "clientId");
CREATE INDEX "FeedbackReport_userId_createdAt_id_idx" ON "FeedbackReport"("userId", "createdAt", "id");
CREATE INDEX "FeedbackReport_status_createdAt_idx" ON "FeedbackReport"("status", "createdAt");
