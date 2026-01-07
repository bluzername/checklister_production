'use client';

import { useState } from 'react';
import { Plus, Loader2, X } from 'lucide-react';
import { PortfolioPosition } from '@/lib/types';
import { addPosition } from '@/app/portfolio-actions';

interface AddPositionFormProps {
    onSuccess: (position: PortfolioPosition) => void;
}

export function AddPositionForm({ onSuccess }: AddPositionFormProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [ticker, setTicker] = useState('');
    const [buyPrice, setBuyPrice] = useState('');
    const [quantity, setQuantity] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const result = await addPosition(
            ticker,
            parseFloat(buyPrice),
            parseFloat(quantity),
            notes || undefined
        );

        if (result.success && result.data) {
            setTicker('');
            setBuyPrice('');
            setQuantity('');
            setNotes('');
            setIsOpen(false);
            onSuccess(result.data);
        } else {
            setError(result.error || 'Failed to add position');
        }

        setLoading(false);
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors"
            >
                <Plus className="w-4 h-4" />
                Add Position
            </button>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Add New Position</h3>
                <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                >
                    <X className="w-4 h-4 text-gray-500" />
                </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Ticker</label>
                    <input
                        type="text"
                        value={ticker}
                        onChange={(e) => setTicker(e.target.value.toUpperCase())}
                        placeholder="AAPL"
                        required
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Buy Price</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={buyPrice}
                        onChange={(e) => setBuyPrice(e.target.value)}
                        placeholder="150.00"
                        required
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Quantity</label>
                    <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="10"
                        required
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                    <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Optional"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>
            </div>

            {error && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {error}
                </div>
            )}

            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add
                </button>
            </div>
        </form>
    );
}









