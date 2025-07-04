import { logWithTimestamp } from "./utils/logger.js"
import { formatBytes, getClientIP, getHourKey } from "./utils/formatter.js"
import { getCountryFromIP } from "./utils/ip-geolocation.js"
import { ensureUserExists } from "./services/user.service.js"
// import { generateUniqueSubdomain } from "./services/tunnel.service" // not used but might so let it be
import { getTunnelByName } from './services/tunnel.service.js'
import { processMetricsBuffer } from "./services/analytics.service.js"
import { storeReqData, storeRespData } from "./middleware/analytics.middleware.js"


import helmet from 'helmet';
// import xssClean from 'xss-clean';
import hpp from 'hpp';


import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { prisma } from './utils/prisma.js'
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// In-memory store for active agents: tunnelId → WebSocket
export const agents = new Map();

// so this stores the response body of requests that are currenlty handled by the agents until it returns the data
const pendingResponses = new Map(); // requestId → Express `res`



// Analytics buffer and tracking
import {
    metricsBuffer,
    uniqueIpsBuffer,
    activeRequests,
} from "./services/analytics.service.js"
// const metricsBuffer = [];
// const uniqueIpsBuffer = new Map(); // tunnelId → Set of IPs
// const activeRequests = new Map(); // requestId → { startTime, tunnelId, req }






/* 
    so before going forward and confuse ourself, some things to make this even clear
    for each user we are storing multiple tunnels 
    and for each tunnel we are storing 
        live stats - just request log at that moment
        hourly stats - combined logs of one hour
        daily stats - same but daily
        request logs - and just the logs plain nothing else
*/





// websokets into action
// Simplified WebSocket registration handler
wss.on('connection', (ws) => {
    let tunnelName = null;
    let tunnelRecord = null;

    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            logWithTimestamp('WARN', '⚠️ Invalid JSON received from WebSocket');
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid JSON format'
            }));
            return;
        }

        if (msg.type === 'register') {
            const { name, token, port, description } = msg;

            console.log("new tunnel is initialised");
            console.log(`tunnel called : ->${name}<-`);

            // Validate tunnel name
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Tunnel name is required and must be a non-empty string'
                }));
                return;
            }

            // Sanitize tunnel name (remove special characters, make URL-safe)
            const sanitizedName = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
            console.log(`sanitized name is called : ->${sanitizedName}<-`);
            try {
                const JWT_SECRET = process.env.JWT_SECRET?.trim();
                if (!JWT_SECRET) {
                    throw new Error('JWT_SECRET not configured');
                }

                const userData = jwt.verify(token, JWT_SECRET);
                ws.user = userData;
                tunnelName = sanitizedName;

                logWithTimestamp('INFO', `🔐 User authenticated`, {
                    userId: userData.userId,
                    email: userData.email,
                    tunnelName
                });

                // Ensure user exists in database
                await ensureUserExists(userData);

                // Check for existing connection and close it
                if (agents.has(tunnelName)) {
                    const oldWs = agents.get(tunnelName);
                    oldWs.close(4002, 'Duplicate tunnel name. Disconnected.');
                    logWithTimestamp('WARN', `Kicked old agent with duplicate tunnel name: ${tunnelName}`);
                    agents.delete(tunnelName);
                }

                // Handle tunnel creation/update
                try {
                    // Look for existing tunnel by name
                    let existingTunnel = await prisma.tunnel.findUnique({
                        where: { name: tunnelName }
                    });

                    // Check if tunnel belongs to the current user
                    if (existingTunnel && existingTunnel.userId !== userData.userId) {
                        // Tunnel name is taken by another user
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Tunnel name '${tunnelName}' is already taken. Please choose a different name.`
                        }));
                        ws.close(4004, 'Tunnel name already taken');
                        return;
                    }

                    if (existingTunnel) {
                        // Update existing tunnel
                        tunnelRecord = await prisma.tunnel.update({
                            where: { id: existingTunnel.id },
                            data: {
                                port: port || existingTunnel.port,
                                description: description || existingTunnel.description,
                                isActive: true,
                                lastConnected: new Date(),
                                connectedAt: new Date(),
                            },
                            include: { user: true }
                        });

                        logWithTimestamp('SUCCESS', `📝 Updated existing tunnel`, {
                            tunnelId: tunnelRecord.id,
                            name: tunnelRecord.name,
                            previouslyActive: existingTunnel.isActive
                        });
                    } else {
                        // Create new tunnel
                        tunnelRecord = await prisma.tunnel.create({
                            data: {
                                userId: userData.userId,
                                name: tunnelName,
                                port: port || 3000,
                                description: description || `Tunnel for ${tunnelName}`,
                                isActive: true,
                                lastConnected: new Date(),
                                connectedAt: new Date(),
                            },
                            include: { user: true }
                        });

                        logWithTimestamp('SUCCESS', `🆕 Created new tunnel`, {
                            tunnelId: tunnelRecord.id,
                            name: tunnelRecord.name,
                            userId: userData.userId
                        });
                    }

                    // Store WebSocket connection using tunnel name as key
                    agents.set(tunnelName, ws);

                    // Send success response
                    const publicUrl = `${process.env.BASE_URL || 'http://localhost:8080'}/${tunnelRecord.name}`;

                    ws.send(JSON.stringify({
                        type: 'registered',
                        success: true,
                        tunnel: {
                            id: tunnelRecord.id,
                            name: tunnelRecord.name,
                            url: publicUrl,
                            isActive: tunnelRecord.isActive,
                            port: tunnelRecord.port,
                            description: tunnelRecord.description,
                            createdAt: tunnelRecord.createdAt,
                            connectedAt: tunnelRecord.connectedAt
                        },
                        message: existingTunnel ? 'Tunnel updated and connected' : 'Tunnel created successfully'
                    }));

                    logWithTimestamp('SUCCESS', `🔗 Tunnel registered successfully`, {
                        tunnelName,
                        publicUrl,
                        user: userData.email,
                        totalActiveAgents: agents.size,
                        isNewTunnel: !existingTunnel
                    });

                } catch (dbError) {
                    logWithTimestamp('ERROR', `Database error during tunnel registration`, {
                        tunnelName,
                        userId: userData.userId,
                        error: dbError.message,
                        code: dbError.code
                    });

                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Failed to register tunnel in database',
                        error: dbError.message
                    }));

                    ws.close(4003, 'Database registration failed');
                    return;
                }
            } catch (authError) {
                logWithTimestamp('ERROR', `Authentication failed`, {
                    error: authError.message,
                    tunnelName
                });

                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Authentication failed',
                    error: authError.message
                }));

                ws.close(4001, 'Authentication failed');
                return;
            }
        }

        // Handle response messages
        else if (msg.type === 'response') {
            const { id, statusCode, headers, body } = msg;
            const res = pendingResponses.get(id);

            if (res) {
                try {
                    res.set(headers || {});
                    let responseBody = body;
                    if (typeof body === 'object' && body !== null) {
                        responseBody = JSON.stringify(body);
                        if (!res.get('content-type')) {
                            res.set('content-type', 'application/json');
                        }
                    }
                    res.status(statusCode || 200).send(responseBody || '');
                    pendingResponses.delete(id);

                    logWithTimestamp('DEBUG', `📤 Response forwarded`, {
                        requestId: id.substring(0, 8),
                        tunnelName,
                        statusCode: statusCode || 200,
                        bodyType: typeof body
                    });
                } catch (error) {
                    logWithTimestamp('ERROR', `Failed to send response`, {
                        requestId: id.substring(0, 8),
                        tunnelName,
                        error: error.message
                    });
                }
            } else {
                logWithTimestamp('WARN', `No pending response found for request ID: ${id.substring(0, 8)}`);
            }
        }

        // Handle ping messages for keepalive
        else if (msg.type === 'ping') {
            ws.send(JSON.stringify({
                type: 'pong',
                timestamp: Date.now()
            }));
        }

        // Handle unknown message types
        else {
            logWithTimestamp('WARN', `Unknown message type received: ${msg.type}`, {
                tunnelName
            });
        }
    });

    ws.on('close', async (code, reason) => {
        if (tunnelName && tunnelRecord) {
            try {
                await prisma.tunnel.update({
                    where: { id: tunnelRecord.id },
                    data: {
                        isActive: false,
                        lastDisconnected: new Date()
                    }
                });

                logWithTimestamp('INFO', `🔌 Tunnel disconnected and marked inactive`, {
                    tunnelId: tunnelRecord.id,
                    name: tunnelRecord.name,
                    code,
                    reason: reason?.toString(),
                    remainingAgents: agents.size - 1
                });
            } catch (error) {
                logWithTimestamp('ERROR', `Failed to update tunnel on disconnect`, {
                    tunnelId: tunnelRecord.id,
                    error: error.message
                });
            }

            agents.delete(tunnelName);
        }
    });

    ws.on('error', (err) => {
        logWithTimestamp('ERROR', `WebSocket error`, {
            tunnelName: tunnelName || 'unknown',
            error: err.message
        });
    });

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to tunnel server',
        timestamp: Date.now()
    }));
});




// Set secure HTTP headers
app.use(helmet());

// Prevent cross-site scripting (XSS)
// app.use(xssClean());

// Prevent HTTP parameter pollution
app.use(hpp());


// HTTP tunnel endpoint with analytics - this is where we will send req with tunnel name so that it will forward this to 
app.use(async (req, res) => {
    const pathParts = req.path.split('/').filter(part => part !== '');

    if (pathParts.length === 0) {
        return res.status(400).json({
            error: 'Invalid tunnel path',
            message: 'Please specify a tunnel subdomain: /{subdomain}/path'
        });
    }

    let [name, ...rest] = pathParts;
    const targetPath = '/' + rest.join('/');

    // Get tunnel from database
    name = name.trim();
    const tunnel = await getTunnelByName(name);
    console.log(`tunnel called : ->${name}<-`);

    if (!tunnel) {
        logWithTimestamp('WARN', `No tunnel found for tunnel name : "${name}"`);
        return res.status(404).json({
            error: 'Tunnel not found',
            message: `No tunnel found for tunnel name : "${name}"`,
            name
        });
    }

    if (!tunnel.isActive) {
        logWithTimestamp('WARN', `Tunnel is inactive: "${name}"`);
        return res.status(503).json({
            error: 'Tunnel inactive',
            message: `Tunnel "${name}" is not currently active`,
            tunnel: {
                id: tunnel.id,
                name: tunnel.name,
                lastConnected: tunnel.lastConnected,
                lastDisconnected: tunnel.lastDisconnected
            }
        });
    }

    // find the web socket connection that is handling this tunnel using tunnel name
    const agent = agents.get(name);

    if (!agent) {
        logWithTimestamp('WARN', `No active agent for tunnel: "${name}"`);
        return res.status(502).json({
            error: 'Tunnel not connected',
            message: `Tunnel "${name}" is not currently connected`,
            tunnel: {
                id: tunnel.id,
                name: tunnel.name,
                isActive: tunnel.isActive,
                lastConnected: tunnel.lastConnected
            }
        });
    }



    // Start analytics tracking using tunnel.id
    const analyticsId = await storeReqData(req, res, tunnel.id);
    const requestId = uuidv4();
    let body = '';

    req.on('data', chunk => body += chunk);

    req.on('end', () => {
        pendingResponses.set(requestId, res);

        try {

            // forward this to web socket so that it can send this to the agent and get back the response 
            agent.send(JSON.stringify({
                type: 'request',
                id: requestId,
                method: req.method,
                path: targetPath,
                headers: req.headers,
                body,
            }));

            // Timeout handling
            const timeoutId = setTimeout(() => {
                if (pendingResponses.has(requestId)) {
                    // Capture timeout as error
                    storeRespData(analyticsId, 504, Date.now() - activeRequests.get(analyticsId)?.startTime || 0, 0);

                    logWithTimestamp('WARN', `⏱️ Request timeout for tunnel ${tunnel.id}`, {
                        requestId: requestId.substring(0, 8),
                        path: targetPath,
                        method: req.method,
                        tunnelName: tunnel.name
                    });

                    res.status(504).send('Request timed out');
                    pendingResponses.delete(requestId);
                }
            }, 10000);

            // Clear timeout if response comes back
            const originalSend = res.send;
            res.send = function (data) {
                clearTimeout(timeoutId);
                return originalSend.call(this, data);
            };

        } catch (err) {
            pendingResponses.delete(requestId);

            // Capture error metrics
            storeRespData(analyticsId, 500, Date.now() - activeRequests.get(analyticsId)?.startTime || 0, 0);

            logWithTimestamp('ERROR', `Failed to send request to tunnel ${tunnel.id}`, {
                error: err.message,
                requestId: requestId.substring(0, 8),
                tunnelName: tunnel.name
            });
            res.status(500).send('Internal tunnel error');
        }
    });

    req.on('error', (err) => {
        logWithTimestamp('ERROR', `Request error for tunnel ${tunnel.id}`, {
            error: err.message,
            requestId: requestId.substring(0, 8),
            tunnelName: tunnel.name
        });
        if (pendingResponses.has(requestId)) {
            storeRespData(analyticsId, 400, Date.now() - activeRequests.get(analyticsId)?.startTime || 0, 0);
            res.status(400).send('Bad request');
            pendingResponses.delete(requestId);
        }
    });
});



// Process metrics buffer every 2 minutes
setInterval(() => {
    logWithTimestamp('INFO', `🔄 Scheduled metrics processing`, {
        bufferSize: metricsBuffer.length,
        uniqueTunnelsWithIps: uniqueIpsBuffer.size
    });
    processMetricsBuffer();
}, 2 * 60 * 1000);




// Clean up old live stats every 10 minutes
setInterval(async () => {
    try {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        const result = await prisma.liveStats.updateMany({
            where: {
                lastUpdated: {
                    lt: tenMinutesAgo
                }
            },
            data: {
                requestsLast5Min: 0,
                requestsLast1Hour: 0
            }
        });

        if (result.count > 0) {
            logWithTimestamp('INFO', `🧹 Cleaned up old live stats`, {
                recordsUpdated: result.count,
                cutoffTime: tenMinutesAgo.toISOString()
            });
        }
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to clean up old live stats', {
            error: error.message
        });
    }
}, 10 * 60 * 1000);




// Daily aggregation job (run once per day at midnight)
async function generateDailyStats() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date(yesterday);
    today.setDate(today.getDate() + 1);

    logWithTimestamp('INFO', `📊 Starting daily stats generation`, {
        date: yesterday.toDateString(),
        dateRange: `${yesterday.toISOString()} to ${today.toISOString()}`
    });

    try {
        const hourlyStats = await prisma.hourlyStats.findMany({
            where: {
                hour: {
                    gte: yesterday,
                    lt: today
                }
            }
        });

        logWithTimestamp('INFO', `Found ${hourlyStats.length} hourly stats records for processing`);

        // Group by tunnel
        const tunnelGroups = new Map();
        hourlyStats.forEach(stat => {
            if (!tunnelGroups.has(stat.tunnelId)) {
                tunnelGroups.set(stat.tunnelId, []);
            }
            tunnelGroups.get(stat.tunnelId).push(stat);
        });

        logWithTimestamp('INFO', `Grouped into ${tunnelGroups.size} tunnels for daily aggregation`);

        // Create daily stats for each tunnel
        for (const [tunnelId, stats] of tunnelGroups) {
            const totalRequests = stats.reduce((sum, s) => sum + s.totalRequests, 0);
            const successRequests = stats.reduce((sum, s) => sum + s.successRequests, 0);
            const errorRequests = stats.reduce((sum, s) => sum + s.errorRequests, 0);
            const avgResponseTime = stats.reduce((sum, s) => sum + s.avgResponseTime, 0) / stats.length;
            const totalBandwidth = stats.reduce((sum, s) => sum + BigInt(s.totalBandwidth), BigInt(0));
            const uniqueIps = stats.reduce((sum, s) => sum + s.uniqueIps, 0);

            // Find peak hour
            const peakHourStat = stats.reduce((max, current) =>
                current.totalRequests > max.totalRequests ? current : max
            );
            const peakHour = peakHourStat.hour.getHours();

            logWithTimestamp('INFO', `📈 Creating daily stats for tunnel ${tunnelId}`, {
                date: yesterday.toDateString(),
                totalRequests,
                successRequests,
                errorRequests,
                errorRate: `${((errorRequests / totalRequests) * 100).toFixed(1)}%`,
                avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
                totalBandwidth: formatBytes(Number(totalBandwidth)),
                uniqueIps,
                peakHour: `${peakHour}:00`,
                hoursWithData: stats.length
            });

            const dailyStats = await prisma.dailyStats.upsert({
                where: {
                    tunnelId_date: { tunnelId, date: yesterday }
                },
                create: {
                    tunnelId,
                    date: yesterday,
                    totalRequests,
                    successRequests,
                    errorRequests,
                    avgResponseTime,
                    totalBandwidth,
                    uniqueIps,
                    peakHour,
                },
                update: {
                    totalRequests,
                    successRequests,
                    errorRequests,
                    avgResponseTime,
                    totalBandwidth,
                    uniqueIps,
                    peakHour,
                }
            });

            logWithTimestamp('SUCCESS', `💾 Daily stats saved for tunnel ${tunnelId}`, {
                recordId: dailyStats.id || 'updated'
            });
        }

        logWithTimestamp('SUCCESS', `✅ Daily stats generation completed`, {
            date: yesterday.toDateString(),
            tunnelsProcessed: tunnelGroups.size,
            totalHourlyRecords: hourlyStats.length
        });

    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to generate daily stats', {
            date: yesterday.toDateString(),
            error: error.message,
            stack: error.stack
        });
    }
}





// Schedule daily stats generation at midnight
const now = new Date();
const midnight = new Date(now);
midnight.setHours(24, 0, 0, 0);
const msUntilMidnight = midnight.getTime() - now.getTime();

logWithTimestamp('INFO', `📅 Scheduling daily stats generation`, {
    nextRun: midnight.toISOString(),
    msUntilMidnight: `${Math.round(msUntilMidnight / 1000 / 60)} minutes`
});

setTimeout(() => {
    generateDailyStats();
    // Then run daily
    setInterval(generateDailyStats, 24 * 60 * 60 * 1000);
}, msUntilMidnight);




const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    logWithTimestamp('SUCCESS', `🚇 Tunnel server with analytics running`, {
        port: PORT,
        url: `http://localhost:${PORT}`,
        metricsBufferLimit: 100,
        metricsProcessingInterval: '2 minutes',
        liveStatsCleanup: '10 minutes',
        dailyStatsGeneration: 'midnight'
    });
});




// Show current status periodically
setInterval(() => {
    if (agents.size > 0) {
        logWithTimestamp('INFO', `📊 Server status update`, {
            activeAgents: agents.size,
            tunnelIds: Array.from(agents.keys()),
            pendingResponses: pendingResponses.size,
            metricsBufferSize: metricsBuffer.length,
            uniqueIpsTracked: uniqueIpsBuffer.size,
            activeRequests: activeRequests.size,
            uptime: `${Math.round(process.uptime())} seconds`
        });
    }
}, 5 * 60 * 1000); // Every 5 minutes






























// Graceful shutdown
process.on('SIGTERM', async () => {
    logWithTimestamp('INFO', '🛑 Received SIGTERM, gracefully shutting down...');

    // Process any remaining metrics
    if (metricsBuffer.length > 0) {
        logWithTimestamp('INFO', `Processing ${metricsBuffer.length} remaining metrics before shutdown...`);
        await processMetricsBuffer();
    }

    // Close all WebSocket connections
    agents.forEach((ws, tunnelId) => {
        logWithTimestamp('INFO', `Closing connection for tunnel: ${tunnelId}`);
        ws.close(1000, 'Server shutting down');
    });

    // Close database connection
    await prisma.$disconnect();

    // Close HTTP server
    server.close(() => {
        logWithTimestamp('SUCCESS', '✅ Server shut down gracefully');
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    logWithTimestamp('INFO', '🛑 Received SIGINT, gracefully shutting down...');

    // Process any remaining metrics
    if (metricsBuffer.length > 0) {
        logWithTimestamp('INFO', `Processing ${metricsBuffer.length} remaining metrics before shutdown...`);
        await processMetricsBuffer();
    }

    // Close all WebSocket connections
    agents.forEach((ws, tunnelId) => {
        logWithTimestamp('INFO', `Closing connection for tunnel: ${tunnelId}`);
        ws.close(1000, 'Server shutting down');
    });

    // Close database connection
    await prisma.$disconnect();

    // Close HTTP server
    server.close(() => {
        logWithTimestamp('SUCCESS', '✅ Server shut down gracefully');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logWithTimestamp('ERROR', '💥 Uncaught Exception', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logWithTimestamp('ERROR', '💥 Unhandled Rejection', {
        reason: reason.toString(),
        promise: promise.toString()
    });
    process.exit(1);
});

// Memory usage monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    const formatMB = (bytes) => Math.round(bytes / 1024 / 1024 * 100) / 100;

    // Log memory usage if it's getting high
    if (memUsage.heapUsed > 100 * 1024 * 1024) { // > 100MB
        logWithTimestamp('WARN', '🧠 High memory usage detected', {
            heapUsed: `${formatMB(memUsage.heapUsed)} MB`,
            heapTotal: `${formatMB(memUsage.heapTotal)} MB`,
            rss: `${formatMB(memUsage.rss)} MB`,
            external: `${formatMB(memUsage.external)} MB`,
            metricsBufferSize: metricsBuffer.length,
            activeRequests: activeRequests.size,
            pendingResponses: pendingResponses.size
        });
    }
}, 60 * 1000); // Every minute

// Export for testing or external use
export default server;