'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, RefreshCw, Briefcase, ChevronUp, ChevronDown, Clock } from 'lucide-react';
import { PortfolioPosition } from '@/lib/types';
import { analyzePortfolioCached } from '@/app/portfolio-actions';
import { AddPositionForm } from './AddPositionForm';
import { PositionRow } from './PositionRow';

type SortField = 'ticker' | 'entry' | 'current' | 'pl_percent' | 'pl_dollar' | 'action';
type SortDirection = 'asc' | 'desc';

interface PortfolioListProps {
    onSelectPosition: (position: PortfolioPosition) => void;
}

function formatTimeAgo(timestamp: number | null): string {
    if (!timestamp) return '';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return '1 min ago';
    if (minutes < 60) return `${minutes} mins ago`;
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hour ago';
    return `${hours} hours ago`;
}

export function PortfolioList({ onSelectPosition }: PortfolioListProps) {
    const [positions, setPositions] = useState<PortfolioPosition[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sortField, setSortField] = useState<SortField>('ticker');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [lastUpdated, setLastUpdated] = useState<number | null>(null);
    const [fromCache, setFromCache] = useState(false);

    const loadPortfolio = useCallback(async (forceRefresh = false) => {
        if (forceRefresh) setRefreshing(true);
        else setLoading(true);

        const result = await analyzePortfolioCached(forceRefresh);

        if (result.success) {
            setPositions(result.data || []);
            setLastUpdated(result.lastUpdated);
            setFromCache(result.fromCache);
            setError(null);
        } else {
            setError(result.error || 'Failed to load portfolio');
        }

        setLoading(false);
        setRefreshing(false);
    }, []);

    useEffect(() => {
        loadPortfolio();
    }, [loadPortfolio]);

    const handleRefresh = () => {
        loadPortfolio(true);  // Force refresh
    };

    const handleAddPosition = useCallback((newPosition: PortfolioPosition) => {
        // Append new position to the list (it will be sorted by useMemo)
        setPositions(prev => [newPosition, ...prev]);
        // Update timestamp since we have fresh data for this position
        setLastUpdated(Date.now());
        setFromCache(false);
    }, []);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const actionPriority: Record<string, number> = {
        'STOP_LOSS': 1,
        'CUT_LOSS': 2,
        'TAKE_PROFIT': 3,
        'PARTIAL_PROFIT': 4,
        'HOLD': 5,
    };

    const sortedPositions = useMemo(() => {
        return [...positions].sort((a, b) => {
            let comparison = 0;
            switch (sortField) {
                case 'ticker':
                    comparison = a.ticker.localeCompare(b.ticker);
                    break;
                case 'entry':
                    comparison = a.buy_price - b.buy_price;
                    break;
                case 'current':
                    comparison = (a.current_price || 0) - (b.current_price || 0);
                    break;
                case 'pl_percent':
                    comparison = (a.profit_loss_percent || 0) - (b.profit_loss_percent || 0);
                    break;
                case 'pl_dollar':
                    const aDollarPL = (a.profit_loss || 0) * (a.remaining_shares ?? a.quantity);
                    const bDollarPL = (b.profit_loss || 0) * (b.remaining_shares ?? b.quantity);
                    comparison = aDollarPL - bDollarPL;
                    break;
                case 'action':
                    comparison = (actionPriority[a.action || 'HOLD'] || 99) - (actionPriority[b.action || 'HOLD'] || 99);
                    break;
            }
            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [positions, sortField, sortDirection]);

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc'
            ? <ChevronUp className="w-3 h-3 inline ml-1" />
            : <ChevronDown className="w-3 h-3 inline ml-1" />;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <AddPositionForm onSuccess={handleAddPosition} />
                <div className="flex items-center gap-3">
                    {/* Cache status indicator */}
                    {lastUpdated && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <Clock className="w-3.5 h-3.5" />
                            <span>
                                {fromCache ? 'Cached' : 'Updated'} {formatTimeAgo(lastUpdated)}
                            </span>
                        </div>
                    )}
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    {error}
                </div>
            )}

            {/* Table */}
            {positions.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl">
                    <Briefcase className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No positions yet</h3>
                    <p className="text-gray-500 text-sm">Add your first position to start tracking your portfolio.</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                    <table className="w-full min-w-[1000px]">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th
                                    onClick={() => handleSort('ticker')}
                                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                                >
                                    Ticker<SortIcon field="ticker" />
                                </th>
                                <th
                                    onClick={() => handleSort('entry')}
                                    className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                                >
                                    Entry<SortIcon field="entry" />
                                </th>
                                <th
                                    onClick={() => handleSort('current')}
                                    className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                                >
                                    Current<SortIcon field="current" />
                                </th>
                                <th
                                    onClick={() => handleSort('pl_percent')}
                                    className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                                >
                                    P/L %<SortIcon field="pl_percent" />
                                </th>
                                <th
                                    onClick={() => handleSort('pl_dollar')}
                                    className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                                >
                                    $ P/L<SortIcon field="pl_dollar" />
                                </th>
                                <th className="px-3 py-3 text-center text-xs font-semibold text-red-500 uppercase tracking-wider">
                                    Stop
                                </th>
                                <th className="px-3 py-3 text-center text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                                    PT1
                                </th>
                                <th className="px-3 py-3 text-center text-xs font-semibold text-teal-600 uppercase tracking-wider">
                                    PT2
                                </th>
                                <th className="px-3 py-3 text-center text-xs font-semibold text-blue-600 uppercase tracking-wider">
                                    PT3
                                </th>
                                <th
                                    onClick={() => handleSort('action')}
                                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                                >
                                    Action<SortIcon field="action" />
                                </th>
                                <th className="px-4 py-3 w-12"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {sortedPositions.map((position) => (
                                <PositionRow
                                    key={position.id}
                                    position={position}
                                    onDelete={() => loadPortfolio(true)}
                                    onSelect={onSelectPosition}
                                    onUpdate={() => loadPortfolio(true)}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Summary */}
            {positions.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="text-xs text-gray-500 mb-1">Total Positions</div>
                        <div className="text-xl font-bold text-gray-900">{positions.length}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="text-xs text-gray-500 mb-1">Hold</div>
                        <div className="text-xl font-bold text-gray-600">
                            {positions.filter(p => p.action === 'HOLD').length}
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="text-xs text-gray-500 mb-1">Action Needed</div>
                        <div className="text-xl font-bold text-amber-600">
                            {positions.filter(p => p.action && p.action !== 'HOLD').length}
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="text-xs text-gray-500 mb-1">Alerts</div>
                        <div className="text-xl font-bold text-red-600">
                            {positions.filter(p => p.action === 'STOP_LOSS' || p.action === 'CUT_LOSS').length}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

