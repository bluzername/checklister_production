import { NextResponse } from 'next/server';
import { getApiStats, getRecentLogs } from '@/lib/data-services/logger';
import { getCacheStats } from '@/lib/data-services/cache';

export async function GET() {
    try {
        const stats = getApiStats();
        const logs = getRecentLogs(50);
        const cacheStats = getCacheStats();

        return NextResponse.json({
            stats,
            logs,
            cacheStats,
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        return NextResponse.json(
            { error: 'Failed to fetch stats' },
            { status: 500 }
        );
    }
}

