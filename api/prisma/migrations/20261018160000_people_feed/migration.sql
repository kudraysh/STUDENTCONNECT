ALTER TABLE "User" ADD COLUMN "feedTutorialCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_feedTutorialCount_check" CHECK ("feedTutorialCount" BETWEEN 0 AND 2);
ALTER TABLE "Notification" ALTER COLUMN "conversationId" DROP NOT NULL;
ALTER TABLE "Notification" ADD COLUMN "profileId" TEXT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_target_check" CHECK (("conversationId" IS NOT NULL)::int + ("profileId" IS NOT NULL)::int = 1);
CREATE TABLE "FeedChoice" (
 "actorId" TEXT NOT NULL, "targetId" TEXT NOT NULL, "decision" TEXT NOT NULL,
 "hiddenUntil" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "FeedChoice_pkey" PRIMARY KEY ("actorId", "targetId"),
 CONSTRAINT "FeedChoice_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "FeedChoice_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "FeedChoice_self_check" CHECK ("actorId" <> "targetId"),
 CONSTRAINT "FeedChoice_decision_check" CHECK ((decision = 'LIKE' AND "hiddenUntil" IS NULL) OR (decision = 'SKIP' AND "hiddenUntil" IS NOT NULL))
);
CREATE INDEX "FeedChoice_actorId_decision_hiddenUntil_idx" ON "FeedChoice"("actorId", "decision", "hiddenUntil");
