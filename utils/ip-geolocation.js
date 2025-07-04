import { logWithTimestamp } from './logger.js';


// Get country from IP using free service
export async function getCountryFromIP(ip) {
    if (ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return 'LOCAL';
    }

    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`);
        const data = await response.json();
        const country = data.countryCode || 'UNKNOWN';

        if (country !== 'UNKNOWN') {
            logWithTimestamp('DEBUG', `🌍 IP geolocation resolved`, {
                ip: ip.replace(/\d+$/, 'xxx'),
                country
            });
        }

        return country;
    } catch (error) {
        logWithTimestamp('WARN', `Failed to get country for IP`, {
            ip: ip.replace(/\d+$/, 'xxx'),
            error: error.message
        });
        return 'UNKNOWN';
    }
}