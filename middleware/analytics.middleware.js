import { prisma } from '../utils/prisma.js'
import { getCountryFromIP } from '../utils/ip-geolocation.js';
import {
    metricsBuffer,
    uniqueIpsBuffer,
    activeRequests,
    updateLiveStats
} from "../services/analytics.service.js";
import { v4 as uuidv4 } from 'uuid';
import { getClientIP, getHourKey, formatBytes } from "../utils/formatter.js"
import { logWithTimestamp } from '../utils/logger.js';



// NOTE!!! :  so one thing is that storeReqdata uses StoreRespData and StoreRespData uses storeRequestLog 


// Analytics middleware
export async function storeReqData(req, res, tunnelId) {
    const startTime = Date.now();
    const requestId = uuidv4();


    // Store request info into a map for later completion
    activeRequests.set(requestId, {
        startTime,
        tunnelId,
        req,
        path: req.path,
        method: req.method,
        clientIp: getClientIP(req),
        requestSize: parseInt(req.get('content-length') || '0')
    });

    // logs this information for debugging thats it
    logWithTimestamp('DEBUG', `📥 Incoming request`, {
        requestId: requestId.substring(0, 8),
        tunnelId: tunnelId,
        method: req.method,
        path: req.path,
        clientIp: getClientIP(req),
        userAgent: req.get('user-agent')?.substring(0, 50) + '...',
        requestSize: formatBytes(parseInt(req.get('content-length') || '0'))
    });

    // Hook into response finish
    const originalSend = res.send;
    const originalStatus = res.status;
    let statusCode = 200;
    let responseSize = 0;

    // so we are besically updating the original methods and some extra steps into it so that we can gather the analytics here
    // so we are implementing and replacing this function to res.status so when its called it does the following thing
    res.status = function (code) {
        statusCode = code;
        return originalStatus.call(this, code);
    };

    // same here we are implementing a function which will be replaced in place of original res.send method this ones do some things more before calling the original res.send method
    res.send = function (data) {
        const responseTime = Date.now() - startTime;
        responseSize = Buffer.byteLength(data || '', 'utf8');

        logWithTimestamp('DEBUG', `📤 Outgoing response`, {
            requestId: requestId.substring(0, 8),
            statusCode,
            responseTime: `${responseTime}ms`,
            responseSize: formatBytes(responseSize)
        });

        // so we are capturing the data before it is being sent back to the user 
        // the storerespdata methid calculates and stores this data into the database
        storeRespData(requestId, statusCode, responseTime, responseSize);
        // and after we calculate the data we simply call the original res.send which we stored earlier 
        return originalSend.call(this, data);
    };

    return requestId;
}

// used by storeReqData 
export async function storeRespData(requestId, statusCode, responseTime, responseSize) {
    // so this method is called from storeReqData so now we have the data that we otherwise wont be able to get now we have everythign that we wanted to capture 
    // so we will take the req data that we previously stored into a map and this new resp data 
    // we can now combine this data and once for all store into the database and be free hehe
    const requestData = activeRequests.get(requestId);
    if (!requestData) return;

    const { tunnelId, req, clientIp, requestSize } = requestData;

    // Get country from IP
    const country = await getCountryFromIP(clientIp);

    const metric = {
        tunnelId: tunnelId,
        path: req.path,
        method: req.method,
        country,
        statusCode,
        responseTime,
        requestSize,
        responseSize,
        clientIp,
        userAgent: req.get('user-agent'),
        timestamp: new Date()
    };

    // Add to buffer so that we can further process this and create hourly and daily and what not kind of metrices as well later
    metricsBuffer.push(metric);

    // again logging this for debugging later thats it
    logWithTimestamp('INFO', `📊 Metric captured for tunnel ${tunnelId}`, {
        path: `${req.method} ${req.path}`,
        statusCode,
        responseTime: `${responseTime}ms`,
        country,
        bufferSize: metricsBuffer.length
    });

    // Track unique IPs per tunnel, so we are also keeping track of differet ips that made request to this tunnel so we can display different people that made request to users tunnel quite impressive right, not really
    if (!uniqueIpsBuffer.has(tunnelId)) {
        uniqueIpsBuffer.set(tunnelId, new Set());
    }
    const wasNewIp = !uniqueIpsBuffer.get(tunnelId).has(clientIp);
    uniqueIpsBuffer.get(tunnelId).add(clientIp);
    if (wasNewIp) {
        logWithTimestamp('INFO', `🌍 New unique visitor for tunnel ${tunnelId}`, {
            country,
            totalUniqueIps: uniqueIpsBuffer.get(tunnelId).size
        });
    }

    // Update live stats immediately, so basically store this into database table for live stats
    await updateLiveStats(tunnelId, metric);

    // Store individual request log store the logs into seperate logs folder 
    await storeRequestLog(metric);

    // Process buffer if it's getting large 
    if (metricsBuffer.length >= 100) {
        logWithTimestamp('WARN', `Buffer size reached 100, processing metrics...`);
        processMetricsBuffer();
    }

    // Clean up
    activeRequests.delete(requestId);
}

// used by storeRespData
// stores all the logs to the database for given tunnel
export async function storeRequestLog(metric) {
    try {
        await prisma.requestLog.create({
            data: {
                tunnelId: metric.tunnelId,
                path: metric.path,
                method: metric.method,
                statusCode: metric.statusCode,
                responseTime: metric.responseTime,
                requestSize: metric.requestSize,
                responseSize: metric.responseSize,
                clientIp: metric.clientIp,
                country: metric.country,
                userAgent: metric.userAgent?.substring(0, 500),
                timestamp: metric.timestamp
            }
        });

        logWithTimestamp('DEBUG', `📝 Request log stored for tunnel ${metric.tunnelId}`);
    } catch (error) {
        logWithTimestamp('ERROR', `Failed to store request log for tunnel ${metric.tunnelId}`, {
            error: error.message
        });
    }
}
