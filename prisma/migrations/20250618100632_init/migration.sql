-- CreateTable
CREATE TABLE "DeviceCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_stats" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "requestsLast5Min" INTEGER NOT NULL DEFAULT 0,
    "requestsLast1Hour" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorRate" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hourly_stats" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "totalRequests" INTEGER NOT NULL,
    "successRequests" INTEGER NOT NULL,
    "errorRequests" INTEGER NOT NULL,
    "avgResponseTime" DOUBLE PRECISION NOT NULL,
    "totalBandwidth" BIGINT NOT NULL,
    "uniqueIps" INTEGER NOT NULL,
    "topPaths" JSONB NOT NULL,
    "topCountries" JSONB NOT NULL,
    "statusCodes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hourly_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalRequests" INTEGER NOT NULL,
    "successRequests" INTEGER NOT NULL,
    "errorRequests" INTEGER NOT NULL,
    "avgResponseTime" DOUBLE PRECISION NOT NULL,
    "totalBandwidth" BIGINT NOT NULL,
    "uniqueIps" INTEGER NOT NULL,
    "peakHour" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_logs" (
    "id" TEXT NOT NULL,
    "tunnelId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "requestSize" INTEGER NOT NULL,
    "responseSize" INTEGER NOT NULL,
    "clientIp" TEXT NOT NULL,
    "country" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCode_code_key" ON "DeviceCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "live_stats_tunnelId_key" ON "live_stats"("tunnelId");

-- CreateIndex
CREATE UNIQUE INDEX "hourly_stats_tunnelId_hour_key" ON "hourly_stats"("tunnelId", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_tunnelId_date_key" ON "daily_stats"("tunnelId", "date");

-- CreateIndex
CREATE INDEX "request_logs_tunnelId_timestamp_idx" ON "request_logs"("tunnelId", "timestamp");

-- AddForeignKey
ALTER TABLE "DeviceCode" ADD CONSTRAINT "DeviceCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
