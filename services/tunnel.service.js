import { prisma } from '../utils/prisma.js'
import { logWithTimestamp } from '../utils/logger.js';


// well not used int the database right now but might use it later :/
export async function generateUniqueSubdomain(baseName, userId) {
    const baseSubdomain = baseName ?
        baseName.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20) :
        `tunnel-${userId.substring(0, 8)}`;

    let subdomain = baseSubdomain;
    let counter = 1;

    while (true) {
        const existing = await prisma.tunnel.findUnique({
            where: { subdomain }
        });

        if (!existing) {
            return subdomain;
        }

        subdomain = `${baseSubdomain}-${counter}`;
        counter++;

        if (counter > 100) {
            return `${baseSubdomain}-${Date.now()}`;
        }
    }
}




// Function to get tunnel by subdomain/agentId
export async function getTunnelByName(identifier) {
    try {
        // First try to find by subdomain
        let tunnel = await prisma.tunnel.findUnique({
            where: { name: identifier },
            include: { user: true }
        });

        return tunnel;
    } catch (error) {
        logWithTimestamp('ERROR', `Failed to get tunnel by identifier: ${identifier}`, {
            error: error.message
        });
        return null;
    }
}
