// Debug script to check tunnel database
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function debugTunnelLookup() {
    console.log('🔍 Debugging tunnel lookup...');
    
    try {
        // 1. Check all tunnels for this user
        const userTunnels = await prisma.tunnel.findMany({
            where: {
                user: {
                    email: "pvks5423@gmail.com"
                }
            },
            include: {
                user: true
            }
        });
        
        console.log('\n📊 All tunnels for user pvks5423@gmail.com:');
        console.log(JSON.stringify(userTunnels, null, 2));
        
        // 2. Check if tunnel exists by subdomain
        const tunnelBySubdomain = await prisma.tunnel.findUnique({
            where: { subdomain: "pratik050403" },
            include: { user: true }
        });
        
        console.log('\n🔍 Tunnel by subdomain "pratik050403":');
        console.log(tunnelBySubdomain ? JSON.stringify(tunnelBySubdomain, null, 2) : 'NOT FOUND');
        
        // 3. Check if tunnel exists by ID
        const tunnelById = await prisma.tunnel.findUnique({
            where: { id: "pratik050403" },
            include: { user: true }
        });
        
        console.log('\n🔍 Tunnel by ID "pratik050403":');
        console.log(tunnelById ? JSON.stringify(tunnelById, null, 2) : 'NOT FOUND');
        
        // 4. Check all tunnels (limited to first 10)
        const allTunnels = await prisma.tunnel.findMany({
            take: 10,
            include: { user: true }
        });
        
        console.log('\n📋 First 10 tunnels in database:');
        console.log(JSON.stringify(allTunnels, null, 2));
        
        // 5. Check user details
        const user = await prisma.user.findUnique({
            where: { email: "pvks5423@gmail.com" },
            include: { tunnels: true }
        });
        
        console.log('\n👤 User details:');
        console.log(user ? JSON.stringify(user, null, 2) : 'USER NOT FOUND');
        
    } catch (error) {
        console.error('❌ Error during debug:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Also add this enhanced logging to your server's getTunnelByIdentifier function
async function getTunnelByIdentifierEnhanced(identifier) {
    try {
        console.log(`🔍 Looking up tunnel with identifier: "${identifier}"`);
        
        // First try to find by subdomain
        let tunnel = await prisma.tunnel.findUnique({
            where: { subdomain: identifier },
            include: { user: true }
        });

        console.log(`📊 Tunnel by subdomain "${identifier}":`, tunnel ? 'FOUND' : 'NOT FOUND');
        if (tunnel) {
            console.log(`   - ID: ${tunnel.id}`);
            console.log(`   - Name: ${tunnel.name}`);
            console.log(`   - Active: ${tunnel.isActive}`);
            console.log(`   - User: ${tunnel.user.email}`);
        }

        // If not found by subdomain, try by tunnel ID
        if (!tunnel) {
            tunnel = await prisma.tunnel.findUnique({
                where: { id: identifier },
                include: { user: true }
            });
            
            console.log(`📊 Tunnel by ID "${identifier}":`, tunnel ? 'FOUND' : 'NOT FOUND');
            if (tunnel) {
                console.log(`   - Subdomain: ${tunnel.subdomain}`);
                console.log(`   - Name: ${tunnel.name}`);
                console.log(`   - Active: ${tunnel.isActive}`);
                console.log(`   - User: ${tunnel.user.email}`);
            }
        }

        if (!tunnel) {
            // Show similar tunnels for debugging
            const similarTunnels = await prisma.tunnel.findMany({
                where: {
                    OR: [
                        { subdomain: { contains: identifier } },
                        { name: { contains: identifier } }
                    ]
                },
                include: { user: true },
                take: 5
            });
            
            console.log(`🔍 Similar tunnels found: ${similarTunnels.length}`);
            similarTunnels.forEach(t => {
                console.log(`   - ${t.subdomain} (ID: ${t.id}, Name: ${t.name})`);
            });
        }

        return tunnel;
    } catch (error) {
        console.error(`❌ Failed to get tunnel by identifier: ${identifier}`, error);
        return null;
    }
}

// Run the debug if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    debugTunnelLookup();
}

export { debugTunnelLookup, getTunnelByIdentifierEnhanced };