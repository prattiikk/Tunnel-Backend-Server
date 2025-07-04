import dotenv from 'dotenv';
dotenv.config();

export const config = {
    port: process.env.PORT || 8080,
    baseUrl: process.env.BASE_URL || 'http://localhost:8080',
    jwtSecret: process.env.JWT_SECRET?.trim(),
    nodeEnv: process.env.NODE_ENV || 'development',

    // Analytics settings
    metricsBufferLimit: 100,
    metricsProcessingInterval: 2 * 60 * 1000, // 2 minutes
    liveStatsCleanupInterval: 10 * 60 * 1000, // 10 minutes
    requestTimeout: 10000, // 10 seconds
};

export const validateConfig = () => {
    if (!config.jwtSecret) {
        throw new Error('JWT_SECRET environment variable is required');
    }
};