
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global;

global.prisma =
    global.prisma ||
    new PrismaClient({
        log: ['query', 'error', 'warn'],
    });

export const prisma = global.prisma;
