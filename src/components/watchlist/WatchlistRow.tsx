'use client';

import { useState, useRef } from 'react';
import { Trash2, Loader2, Sparkles, RefreshCw, Calendar, AlertTriangle, Ban } from 'lucide-react';
import { WatchlistItem } from '@/lib/types';
import { removeFromWatchlist, updateWatchlistDate } from '@/app/watchlist-actions';

interface WatchlistRowProps {
    item: WatchlistItem;
    onDelete: () => void;
    onSelect: (item: WatchlistItem) => void;
    onDateUpdate: () => void;
}

export function WatchlistRow({ item, onDelete, onSelect, onDateUpdate }: WatchlistRowProps) {
    const [deleting, setDeleting] = useState(false);
    const [updatingDate, setUpdatingDate] = useState(false);
    const dateInputRef = useRef<HTMLInputElement>(null);

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Remove ${item.ticker} from your watchlist?`)) return;

        setDeleting(true);
        const result = await removeFromWatchlist(item.id);
        if (result.success) {
            onDelete();
        } else {
            alert(result.error || 'Failed to remove from watchlist');
        }
        setDeleting(false);
    };

    const handleResetDate = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setUpdatingDate(true);
        const result = await updateWatchlistDate(item.id);
        if (result.success) {
            onDateUpdate();
        } else {
            alert(result.error || 'Failed to reset date');
        }
        setUpdatingDate(false);
    };

    const handleDatePicker = (e: React.MouseEvent) => {
        e.stopPropagation();
        dateInputRef.current?.showPicker();
    };

    const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        const newDate = e.target.value;
        if (!newDate) return;

        setUpdatingDate(true);
        const result = await updateWatchlistDate(item.id, new Date(newDate));
        if (result.success) {
            onDateUpdate();
        } else {
            alert(result.error || 'Failed to update date');
        }
        setUpdatingDate(false);
    };

    const getScoreColor = (score: number) => {
        if (score >= 70) return 'text-emerald-600 bg-emerald-50';
        if (score >= 50) return 'text-amber-600 bg-amber-50';
        return 'text-red-600 bg-red-50';
    };

    const getStalenessColor = (percent: number) => {
        if (percent <= 33) return 'bg-emerald-500'; // 0-15 days (green)
        if (percent <= 66) return 'bg-amber-500';   // 16-30 days (yellow)
        if (percent <= 88) return 'bg-orange-500';  // 31-40 days (orange)
        return 'bg-red-500';                         // 41-45 days (red)
    };

    const getStalenessTextColor = (percent: number) => {
        if (percent <= 33) return 'text-emerald-700';
        if (percent <= 66) return 'text-amber-700';
        if (percent <= 88) return 'text-orange-700';
        return 'text-red-700';
    };

    const days = item.days_in_watchlist ?? 0;
    const percent = item.staleness_percent ?? 0;

    return (
        <tr
            className="hover:bg-gray-50 transition-colors cursor-pointer"
            onClick={() => onSelect(item)}
        >
            <td className="px-4 py-3">
                <div className="font-semibold text-gray-900">{item.ticker}</div>
                {item.notes && (
                    <div className="text-xs text-gray-500 truncate max-w-[200px]">{item.notes}</div>
                )}
            </td>
            <td className="px-4 py-3 text-right">
                {item.current_price ? (
                    <div className="font-medium text-gray-900">${item.current_price.toFixed(2)}</div>
                ) : (
                    <div className="text-gray-400">--</div>
                )}
            </td>
            <td className="px-4 py-3 text-center">
                {item.score !== undefined ? (
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-semibold ${getScoreColor(item.score)}`}>
                        {item.score}%
                    </span>
                ) : (
                    <span className="text-gray-400 text-sm">Analyzing...</span>
                )}
            </td>
            <td className="px-4 py-3">
                {item.is_good_entry ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                        <Sparkles className="w-3.5 h-3.5" />
                        GOOD ENTRY
                    </span>
                ) : item.analysis?.veto_analysis?.verdict === 'VETO' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full bg-red-100 text-red-700 border border-red-200">
                        <Ban className="w-3.5 h-3.5" />
                        POOR TIMING
                    </span>
                ) : item.analysis?.veto_analysis?.verdict === 'CAUTION' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        CAUTION
                    </span>
                ) : item.score !== undefined ? (
                    <span className="text-gray-400 text-sm">Watching</span>
                ) : null}
            </td>
            <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                    {/* Staleness progress bar */}
                    <div className="flex-1 min-w-[60px]">
                        <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className={`h-full ${getStalenessColor(percent)} transition-all`}
                                    style={{ width: `${percent}%` }}
                                />
                            </div>
                            <span className={`text-xs font-medium ${getStalenessTextColor(percent)} whitespace-nowrap`}>
                                {days}d
                            </span>
                        </div>
                    </div>

                    {/* Date actions */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleResetDate}
                            disabled={updatingDate}
                            className="p-1 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors disabled:opacity-50"
                            title="Reset to today"
                        >
                            {updatingDate ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                            )}
                        </button>
                        <button
                            onClick={handleDatePicker}
                            disabled={updatingDate}
                            className="p-1 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors disabled:opacity-50"
                            title="Set custom date"
                        >
                            <Calendar className="w-3.5 h-3.5" />
                        </button>
                        <input
                            ref={dateInputRef}
                            type="date"
                            className="sr-only"
                            max={new Date().toISOString().split('T')[0]}
                            defaultValue={new Date(item.date_added).toISOString().split('T')[0]}
                            onChange={handleDateChange}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                </div>
            </td>
            <td className="px-4 py-3">
                <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
            </td>
        </tr>
    );
}
