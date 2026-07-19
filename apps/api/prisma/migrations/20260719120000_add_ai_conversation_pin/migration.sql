ALTER TABLE "AiConversation" ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE INDEX "AiConversation_userId_pinnedAt_updatedAt_idx"
ON "AiConversation"("userId", "pinnedAt", "updatedAt");
