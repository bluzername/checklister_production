'use client';

import { PortfolioList } from '@/components/portfolio/PortfolioList';
import { PortfolioPosition } from '@/lib/types';

interface PortfolioTabProps {
    onSelectPosition: (position: PortfolioPosition) => void;
}

export function PortfolioTab({ onSelectPosition }: PortfolioTabProps) {
    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Portfolio</h1>
                <p className="text-gray-500 text-sm">Track your positions and get action recommendations.</p>
            </div>
            <PortfolioList onSelectPosition={onSelectPosition} />
        </div>
    );
}


