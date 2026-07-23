CREATE TABLE "ServerMetricSample" (
    "id" TEXT NOT NULL,
    "cpuUsagePercent" DOUBLE PRECISION NOT NULL,
    "memoryUsagePercent" DOUBLE PRECISION NOT NULL,
    "diskUsagePercent" DOUBLE PRECISION NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerMetricSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServerMetricSample_sampledAt_idx"
ON "ServerMetricSample"("sampledAt");
