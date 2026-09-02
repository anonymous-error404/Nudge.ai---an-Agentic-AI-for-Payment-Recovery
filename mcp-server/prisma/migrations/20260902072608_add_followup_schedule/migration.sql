-- CreateTable
CREATE TABLE "FollowUpSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "failureEventId" TEXT NOT NULL,
    "nextExecutionAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FollowUpSchedule_failureEventId_fkey" FOREIGN KEY ("failureEventId") REFERENCES "FailureEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FollowUpSchedule_status_nextExecutionAt_idx" ON "FollowUpSchedule"("status", "nextExecutionAt");
