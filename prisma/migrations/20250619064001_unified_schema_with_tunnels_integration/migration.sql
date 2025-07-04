-- AlterTable
ALTER TABLE "tunnels" ADD COLUMN     "connectedAt" TIMESTAMP(3),
ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "lastConnected" TIMESTAMP(3),
ADD COLUMN     "lastDisconnected" TIMESTAMP(3),
ADD COLUMN     "localPort" INTEGER NOT NULL DEFAULT 3000,
ADD COLUMN     "protocol" TEXT NOT NULL DEFAULT 'http',
ADD COLUMN     "totalBandwidth" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "totalRequests" BIGINT NOT NULL DEFAULT 0,
ALTER COLUMN "isActive" SET DEFAULT false;

-- CreateIndex
CREATE INDEX "tunnels_isActive_idx" ON "tunnels"("isActive");

-- CreateIndex
CREATE INDEX "tunnels_subdomain_idx" ON "tunnels"("subdomain");

-- CreateIndex
CREATE INDEX "tunnels_lastConnected_idx" ON "tunnels"("lastConnected");
