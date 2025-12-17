'use client';

import React from 'react';
import { AnalysisResult } from '@/lib/types';
import { CriteriaList } from './CriteriaList';
import { TradingViewChart } from './TradingViewChart';
import { RegimeBadge } from './RegimeBadge';
import { MultiTimeframeBadge } from './MultiTimeframeBadge';
import { VetoAnalysisBadge } from './VetoAnalysisBadge';

export function Dashboard({ data }: { data: AnalysisResult }) {
    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {/* ML Veto Analysis Banner */}
            {data.veto_analysis && (
                <div className="mb-6">
                    <VetoAnalysisBadge
                        vetoed={data.veto_analysis.vetoed}
                        pLoss={data.veto_analysis.pLoss}
                        pWin={data.veto_analysis.pWin}
                        verdict={data.veto_analysis.verdict}
                        confidence={data.veto_analysis.confidence}
                        reasons={data.veto_analysis.reasons}
                    />
                </div>
            )}

            {/* Market Context Banners */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                {/* Market Regime Banner */}
                {data.market_regime && (
                    <RegimeBadge
                        regime={data.market_regime.regime}
                        confidence={data.market_regime.confidence}
                        details={data.market_regime.details}
                        thresholds={data.regime_thresholds}
                        regimeAdjusted={data.regime_adjusted}
                        originalScore={data.original_score}
                        currentScore={data.success_probability}
                    />
                )}
                
                {/* Multi-Timeframe Analysis Banner */}
                {data.multi_timeframe && (
                    <MultiTimeframeBadge
                        dailyScore={data.multi_timeframe.daily_score}
                        hour4Score={data.multi_timeframe.hour4_score}
                        combinedScore={data.multi_timeframe.combined_score}
                        alignment={data.multi_timeframe.alignment}
                        macd4hStatus={data.multi_timeframe.macd_4h_status}
                        rsi4h={data.multi_timeframe.rsi_4h}
                        resistance4h={data.multi_timeframe.resistance_4h}
                        support4h={data.multi_timeframe.support_4h}
                        currentPrice={data.current_price}
                    />
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-start">
                {/* Left Column: 10-Point Analysis */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100">
                        <h2 className="text-xl font-bold text-gray-900">
                            10-Point Swing Analysis: <span className="text-teal-600">{data.ticker}</span>
                        </h2>
                    </div>
                    <CriteriaList data={data} />
                </div>

                {/* Right Column: TradingView Chart */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100">
                        <h2 className="text-xl font-bold text-gray-900">
                            {data.ticker} Chart
                        </h2>
                    </div>
                    <div className="p-4">
                        <TradingViewChart symbol={data.ticker} />
                    </div>
                </div>
            </div>

            {/* Bottom Stats Bar */}
            <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div>
                        <div className="text-sm text-gray-500 mb-1">Current Price</div>
                        <div className="text-2xl font-bold text-gray-900">${data.current_price.toFixed(2)}</div>
                    </div>
                    <div>
                        <div className="text-sm text-gray-500 mb-1">Success Probability</div>
                        <div className="text-2xl font-bold text-teal-600">{data.success_probability}%</div>
                    </div>
                    <div>
                        <div className="text-sm text-gray-500 mb-1">Recommendation</div>
                        <div className={`text-2xl font-bold ${
                            data.recommendation.includes('BUY') ? 'text-emerald-600' :
                            data.recommendation.includes('AVOID') ? 'text-red-600' : 'text-amber-600'
                        }`}>
                            {data.recommendation}
                        </div>
                    </div>
                    <div>
                        <div className="text-sm text-gray-500 mb-1">Trade Type</div>
                        <div className="text-2xl font-bold text-gray-900">{data.trade_type.replace('_', ' ')}</div>
                    </div>
                </div>
            </div>

            {/* Disclaimer */}
            <div className="mt-6 text-center text-xs text-gray-400">
                {data.disclaimers.join(' • ')}
            </div>
        </div>
    );
}
