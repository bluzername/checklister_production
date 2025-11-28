'use client';

import React from 'react';
import { AnalysisResult } from '@/lib/types';
import { 
    TrendingUp, 
    Building2, 
    Briefcase, 
    Zap, 
    BarChart3,
    Target,
    Activity,
    Volume2,
    LineChart,
    Gauge
} from 'lucide-react';
import { CriteriaRow } from './CriteriaRow';

const criteriaConfig = [
    { key: '1_market_condition', label: 'Market Condition', icon: TrendingUp },
    { key: '2_sector_condition', label: 'Sector Condition', icon: Building2 },
    { key: '3_company_condition', label: 'Company Condition', icon: Briefcase },
    { key: '4_catalyst', label: 'Catalyst', icon: Zap },
    { key: '5_patterns_gaps', label: 'Patterns & Gaps', icon: BarChart3 },
    { key: '6_support_resistance', label: 'Support & Resistance', icon: Target },
    { key: '7_price_movement', label: 'Price Movement', icon: Activity },
    { key: '8_volume', label: 'Volume', icon: Volume2 },
    { key: '9_ma_fibonacci', label: 'MA & Fibonacci', icon: LineChart },
    { key: '10_rsi', label: 'RSI Momentum', icon: Gauge },
] as const;

export function CriteriaList({ data }: { data: AnalysisResult }) {
    const { parameters } = data;

    return (
        <div className="divide-y divide-gray-100">
            {criteriaConfig.map((criteria, index) => {
                const param = parameters[criteria.key as keyof typeof parameters];
                return (
                    <CriteriaRow
                        key={criteria.key}
                        number={index + 1}
                        label={criteria.label}
                        icon={criteria.icon}
                        score={param.score}
                        rationale={param.rationale}
                    />
                );
            })}
        </div>
    );
}


