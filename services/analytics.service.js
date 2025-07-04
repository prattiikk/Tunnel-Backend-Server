import { prisma } from '../utils/prisma.js'
import { logWithTimestamp } from '../utils/logger.js';
import { formatBytes, getHourKey } from '../utils/formatter.js';


// Analytics state
export const metricsBuffer = [];
export const uniqueIpsBuffer = new Map();
export const activeRequests = new Map();



// Update live stats for real-time dashboard and update the live status of the user
export async function updateLiveStats(tunnelId, metric) {
    try {
        const liveStats = await prisma.liveStats.upsert({
            where: { tunnelId },
            create: {
                tunnelId,
                requestsLast5Min: 1,
                requestsLast1Hour: 1,
                avgResponseTime: metric.responseTime,
                errorRate: metric.statusCode >= 400 ? 1 : 0,
                lastUpdated: new Date()
            },
            update: {
                requestsLast5Min: { increment: 1 },
                requestsLast1Hour: { increment: 1 },
                avgResponseTime: metric.responseTime,
                errorRate: metric.statusCode >= 400 ? { increment: 1 } : undefined,
                lastUpdated: new Date()
            }
        });

        logWithTimestamp('SUCCESS', `💾 Live stats updated for tunnel ${tunnelId}`, {
            requests5Min: liveStats.requestsLast5Min,
            requests1Hour: liveStats.requestsLast1Hour,
            avgResponseTime: `${liveStats.avgResponseTime}ms`,
            errorRate: liveStats.errorRate,
            isError: metric.statusCode >= 400
        });

    } catch (error) {
        logWithTimestamp('ERROR', `Failed to update live stats for tunnel ${tunnelId}`, {
            error: error.message,
            tunnelId,
            metric
        });
    }
}

// Update hourly aggregated stats
export async function updateHourlyStats(hourKey, metrics) {
    const [tunnelId, hourString] = hourKey.split('-', 2);
    const hour = new Date(hourString);

    // Calculate aggregated metrics
    const totalRequests = metrics.length;
    const successRequests = metrics.filter(m => m.statusCode < 400).length;
    const errorRequests = totalRequests - successRequests;
    const avgResponseTime = metrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests;
    const totalBandwidth = metrics.reduce((sum, m) => sum + m.requestSize + m.responseSize, 0);

    // Get unique IPs for this tunnel and hour
    const uniqueIps = new Set(metrics.map(m => m.clientIp)).size;

    // Aggregate top paths
    const pathCounts = new Map();
    metrics.forEach(m => {
        const key = `${m.method} ${m.path}`;
        pathCounts.set(key, (pathCounts.get(key) || 0) + 1);
    });
    const topPaths = Object.fromEntries(
        Array.from(pathCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
    );

    // Aggregate top countries
    const countryCounts = new Map();
    metrics.forEach(m => {
        if (m.country) {
            countryCounts.set(m.country, (countryCounts.get(m.country) || 0) + 1);
        }
    });
    const topCountries = Object.fromEntries(
        Array.from(countryCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
    );

    // Aggregate status codes
    const statusCounts = new Map();
    metrics.forEach(m => {
        const code = m.statusCode.toString();
        statusCounts.set(code, (statusCounts.get(code) || 0) + 1);
    });
    const statusCodes = Object.fromEntries(statusCounts);

    logWithTimestamp('INFO', `📈 Updating hourly stats for tunnel ${tunnelId}`, {
        hour: hour.toISOString(),
        totalRequests,
        successRequests,
        errorRequests,
        errorRate: `${((errorRequests / totalRequests) * 100).toFixed(1)}%`,
        avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
        totalBandwidth: formatBytes(totalBandwidth),
        uniqueIps,
        topPaths: Object.keys(topPaths).slice(0, 3),
        topCountries: Object.keys(topCountries).slice(0, 3)
    });

    try {
        const result = await prisma.hourlyStats.upsert({
            where: {
                tunnelId_hour: { tunnelId, hour }
            },
            create: {
                tunnelId,
                hour,
                totalRequests,
                successRequests,
                errorRequests,
                avgResponseTime,
                totalBandwidth: BigInt(totalBandwidth),
                uniqueIps,
                topPaths,
                topCountries,
                statusCodes,
            },
            update: {
                totalRequests: { increment: totalRequests },
                successRequests: { increment: successRequests },
                errorRequests: { increment: errorRequests },
                avgResponseTime: avgResponseTime,
                totalBandwidth: { increment: BigInt(totalBandwidth) },
                uniqueIps: { increment: uniqueIps },
                topPaths,
                topCountries,
                statusCodes,
            }
        });

        logWithTimestamp('SUCCESS', `💾 Hourly stats saved to database`, {
            tunnelId,
            hour: hour.toISOString(),
            recordId: result.id || 'updated'
        });

    } catch (error) {
        logWithTimestamp('ERROR', `Failed to update hourly stats`, {
            tunnelId,
            hour: hour.toISOString(),
            error: error.message,
            stack: error.stack
        });
    }
}













// Process buffered metrics
export async function processMetricsBuffer() {
    if (metricsBuffer.length === 0) return;

    logWithTimestamp('INFO', `🔄 Processing metrics buffer`, {
        totalMetrics: metricsBuffer.length,
        uniqueTunnels: new Set(metricsBuffer.map(m => m.tunnelId)).size
    });

    // Group metrics by tunnel and hour
    const hourlyGroups = new Map();

    for (const metric of metricsBuffer) {
        const hourKey = `${metric.tunnelId}-${getHourKey(metric.timestamp)}`;
        if (!hourlyGroups.has(hourKey)) {
            hourlyGroups.set(hourKey, []);
        }
        hourlyGroups.get(hourKey).push(metric);
    }

    logWithTimestamp('INFO', `📊 Grouped into ${hourlyGroups.size} hourly buckets`);

    // Process each hourly group
    for (const [hourKey, metrics] of hourlyGroups) {
        await updateHourlyStats(hourKey, metrics);
    }

    // Show summary of what was processed
    const tunnelSummary = {};
    metricsBuffer.forEach(metric => {
        if (!tunnelSummary[metric.tunnelId]) {
            tunnelSummary[metric.tunnelId] = { requests: 0, errors: 0, countries: new Set() };
        }
        tunnelSummary[metric.tunnelId].requests++;
        if (metric.statusCode >= 400) tunnelSummary[metric.tunnelId].errors++;
        tunnelSummary[metric.tunnelId].countries.add(metric.country);
    });

    logWithTimestamp('SUCCESS', `✅ Processed ${metricsBuffer.length} metrics`, {
        tunnelSummary: Object.fromEntries(
            Object.entries(tunnelSummary).map(([tunnelId, stats]) => [
                tunnelId,
                {
                    requests: stats.requests,
                    errors: stats.errors,
                    errorRate: `${((stats.errors / stats.requests) * 100).toFixed(1)}%`,
                    countries: stats.countries.size
                }
            ])
        )
    });

    // Clear processed metrics
    metricsBuffer.length = 0;
    uniqueIpsBuffer.clear();
}
