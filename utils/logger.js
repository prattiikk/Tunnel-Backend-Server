export function logWithTimestamp(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = {
        'INFO': '📊',
        'SUCCESS': '✅',
        'ERROR': '❌',
        'WARN': '⚠️',
        'DEBUG': '🔍'
    }[level] || 'ℹ️';

    console.log(`${prefix} [${timestamp}] ${message}`);

    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}