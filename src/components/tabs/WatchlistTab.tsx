'use client';

import { WatchlistTable } from '@/components/watchlist/WatchlistTable';
import { WatchlistItem } from '@/lib/types';

interface WatchlistTabProps {
    onSelectItem: (item: WatchlistItem) => void;
}

export function WatchlistTab({ onSelectItem }: WatchlistTabProps) {
    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
                <p className="text-gray-500 text-sm">Monitor stocks for good entry opportunities.</p>
            </div>
            <WatchlistTable onSelectItem={onSelectItem} />
        </div>
    );
}


