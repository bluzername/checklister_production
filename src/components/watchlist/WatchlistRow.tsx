'use client';

import { useState } from 'react';
import { Trash2, Loader2, Sparkles } from 'lucide-react';
import { WatchlistItem } from '@/lib/types';
import { removeFromWatchlist } from '@/app/watchlist-actions';

interface WatchlistRowProps {
    item: WatchlistItem;
    onDelete: () => void;
    onSelect: (item: WatchlistItem) => void;
}

export function WatchlistRow({ item, onDelete, onSelect }: WatchlistRowProps) {
    const [deleting, setDeleting] = useState(false);

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

    const getScoreColor = (score: number) => {
        if (score >= 70) return 'text-emerald-600 bg-emerald-50';
        if (score >= 50) return 'text-amber-600 bg-amber-50';
        return 'text-red-600 bg-red-50';
    };

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
                ) : item.score !== undefined ? (
                    <span className="text-gray-400 text-sm">Watching</span>
                ) : null}
            </td>
            <td className="px-4 py-3 text-right text-xs text-gray-500">
                {new Date(item.date_added).toLocaleDateString()}
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


