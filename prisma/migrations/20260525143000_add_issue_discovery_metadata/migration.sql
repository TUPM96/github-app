-- AlterTable
ALTER TABLE "Bounty"
ADD COLUMN "issueTitle" TEXT,
ADD COLUMN "issueUrl" TEXT,
ADD COLUMN "issueState" TEXT,
ADD COLUMN "issueBodyExcerpt" TEXT,
ADD COLUMN "issueCreatedAt" TIMESTAMP(3),
ADD COLUMN "issueUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Bounty_issueUpdatedAt_idx" ON "Bounty"("issueUpdatedAt");

-- CreateIndex
CREATE INDEX "Bounty_amount_idx" ON "Bounty"("amount");
