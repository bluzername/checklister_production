'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, RefreshCw, Eye, Sparkles, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { WatchlistItem } from '@/lib/types';
import { analyzeWatchlist } from '@/app/watchlist-actions';
import { AddWatchlistForm } from './AddWatchlistForm';
import { WatchlistRow } from './WatchlistRow';

type SortColumn = 'ticker' | 'price' | 'score' | 'signal' | 'date_added';
type SortDirection = 'asc' | 'desc';

interface WatchlistTableProps {
    onSelectItem: (item: WatchlistItem) => void;
}

export function WatchlistTable({ onSelectItem }: WatchlistTableProps) {
    const [items, setItems] = useState<WatchlistItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sortColumn, setSortColumn] = useState<SortColumn>('date_added');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    // Handle column header click for sorting
    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            // Toggle direction if same column
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // New column, default to descending for numbers/dates, ascending for text
            setSortColumn(column);
            setSortDirection(column === 'ticker' ? 'asc' : 'desc');
        }
    };

    // Sort items based on current sort state
    const sortedItems = useMemo(() => {
        const sorted = [...items].sort((a, b) => {
            let comparison = 0;

            switch (sortColumn) {
                case 'ticker':
                    comparison = a.ticker.localeCompare(b.ticker);
                    break;
                case 'price':
                    comparison = (a.current_price || 0) - (b.current_price || 0);
                    break;
                case 'score':
                    comparison = (a.score || 0) - (b.score || 0);
                    break;
                case 'signal':
                    // Sort by is_good_entry (true first when desc)
                    comparison = (a.is_good_entry ? 1 : 0) - (b.is_good_entry ? 1 : 0);
                    break;
                case 'date_added':
                    comparison = new Date(a.date_added).getTime() - new Date(b.date_added).getTime();
                    break;
            }

            return sortDirection === 'asc' ? comparison : -comparison;
        });

        return sorted;
    }, [items, sortColumn, sortDirection]);

    // Render sort icon for column header
    const SortIcon = ({ column }: { column: SortColumn }) => {
        if (sortColumn !== column) {
            return <ChevronsUpDown className="w-3 h-3 text-gray-400" />;
        }
        return sortDirection === 'asc'
            ? <ChevronUp className="w-3 h-3 text-teal-600" />
            : <ChevronDown className="w-3 h-3 text-teal-600" />;
    };

    const loadWatchlist = useCallback(async (showRefresh = false) => {
        if (showRefresh) setRefreshing(true);
        else setLoading(true);
        
        const result = await analyzeWatchlist();
        
        if (result.success) {
            setItems(result.data || []);
            setError(null);
        } else {
            setError(result.error || 'Failed to load watchlist');
        }
        
        setLoading(false);
        setRefreshing(false);
    }, []);

    useEffect(() => {
        loadWatchlist();
    }, [loadWatchlist]);

    const handleRefresh = () => {
        loadWatchlist(true);
    };

    const goodEntryCount = items.filter(i => i.is_good_entry).length;

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
                <AddWatchlistForm onSuccess={() => loadWatchlist(true)} />
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Good Entry Alert */}
            {goodEntryCount > 0 && (
                <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                        <div className="font-semibold text-emerald-800">
                            {goodEntryCount} Good {goodEntryCount === 1 ? 'Entry' : 'Entries'} Found!
                        </div>
                        <div className="text-sm text-emerald-600">
                            These stocks have high scores and are near support levels.
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    {error}
                </div>
            )}

            {/* Table */}
            {items.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl">
                    <Eye className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No items in watchlist</h3>
                    <p className="text-gray-500 text-sm">Add tickers to watch for good entry opportunities.</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th
                                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                    onClick={() => handleSort('ticker')}
                                >
                                    <div className="flex items-center gap-1">
                                        Ticker
                                        <SortIcon column="ticker" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                    onClick={() => handleSort('price')}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        Price
                                        <SortIcon column="price" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                    onClick={() => handleSort('score')}
                                >
                                    <div className="flex items-center justify-center gap-1">
                                        Score
                                        <SortIcon column="score" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                    onClick={() => handleSort('signal')}
                                >
                                    <div className="flex items-center gap-1">
                                        Signal
                                        <SortIcon column="signal" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                                    onClick={() => handleSort('date_added')}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        Added
                                        <SortIcon column="date_added" />
                                    </div>
                                </th>
                                <th className="px-4 py-3 w-12"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {sortedItems.map((item) => (
                                <WatchlistRow
                                    key={item.id}
                                    item={item}
                                    onDelete={() => loadWatchlist(true)}
                                    onSelect={onSelectItem}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Summary */}
            {items.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="text-xs text-gray-500 mb-1">Watching</div>
                        <div className="text-xl font-bold text-gray-900">{items.length}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="text-xs text-gray-500 mb-1">Good Entries</div>
                        <div className="text-xl font-bold text-emerald-600">{goodEntryCount}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="text-xs text-gray-500 mb-1">High Score (70+)</div>
                        <div className="text-xl font-bold text-teal-600">
                            {items.filter(i => i.score && i.score >= 70).length}
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="text-xs text-gray-500 mb-1">Low Score (&lt;50)</div>
                        <div className="text-xl font-bold text-red-600">
                            {items.filter(i => i.score && i.score < 50).length}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}









