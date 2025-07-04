
import { prisma } from '../utils/prisma.js'
import { logWithTimestamp } from '../utils/logger.js';


export async function ensureUserExists(userData) {
    try {
        const { userId, email, name } = userData;

        let user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            if (email) {
                user = await prisma.user.findUnique({
                    where: { email }
                });
            }

            if (!user) {
                user = await prisma.user.create({
                    data: {
                        id: userId,
                        email: email || `user_${userId}@unknown.com`,
                        name: name || `User ${userId.substring(0, 8)}`
                    }
                });

                logWithTimestamp('SUCCESS', `👤 Created new user`, {
                    userId: user.id,
                    email: user.email,
                    name: user.name
                });
            } else if (user.id !== userId) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { id: userId }
                });
            }
        }

        return user;
    } catch (error) {
        logWithTimestamp('ERROR', `Failed to ensure user exists`, {
            userData,
            error: error.message
        });
        throw error;
    }
}