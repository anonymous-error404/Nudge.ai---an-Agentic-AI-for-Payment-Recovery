-- CreateTable
CREATE TABLE "FailureEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "classifiedCategory" TEXT NOT NULL,
    "amountBucket" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RecoveryAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "failureEventId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "actionType" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "attemptNumber" INTEGER NOT NULL,
    "agentReasoning" TEXT,
    "notificationContent" TEXT,
    "executedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecoveryAction_failureEventId_fkey" FOREIGN KEY ("failureEventId") REFERENCES "FailureEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FailureEvent_merchantId_externalRef_key" ON "FailureEvent"("merchantId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryAction_jobId_key" ON "RecoveryAction"("jobId");
