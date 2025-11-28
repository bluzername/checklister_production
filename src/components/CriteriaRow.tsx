'use client';

import React from 'react';
import { Check, X, LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';

interface CriteriaRowProps {
    number: number;
    label: string;
    icon: LucideIcon;
    score: number;
    rationale: string;
}

export function CriteriaRow({ number, label, icon: Icon, score, rationale }: CriteriaRowProps) {
    const isPassing = score >= 6;
    const percentage = (score / 10) * 100;

    return (
        <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: number * 0.05 }}
            className="px-6 py-4 hover:bg-gray-50 transition-colors group"
        >
            <div className="flex items-center gap-4">
                {/* Icon */}
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-teal-50 group-hover:text-teal-600 transition-colors">
                    <Icon className="w-4 h-4" />
                </div>

                {/* Label */}
                <div className="flex-shrink-0 w-40">
                    <span className="text-sm font-medium text-gray-900">
                        {number}. {label}
                    </span>
                </div>

                {/* Score */}
                <div className="flex-shrink-0 w-24 text-sm text-gray-500">
                    Score: <span className="font-semibold text-gray-700">{score}/10</span>
                </div>

                {/* Progress Bar */}
                <div className="flex-1 min-w-0">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${percentage}%` }}
                            transition={{ delay: number * 0.05 + 0.2, duration: 0.5 }}
                            className={`h-full rounded-full ${
                                score >= 8 ? 'bg-emerald-500' :
                                score >= 6 ? 'bg-teal-500' :
                                score >= 4 ? 'bg-amber-500' :
                                'bg-red-500'
                            }`}
                        />
                    </div>
                </div>

                {/* Pass/Fail Indicator */}
                <div className="flex-shrink-0">
                    {isPassing ? (
                        <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center">
                            <Check className="w-4 h-4 text-emerald-600" />
                        </div>
                    ) : (
                        <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
                            <X className="w-4 h-4 text-red-600" />
                        </div>
                    )}
                </div>
            </div>

            {/* Rationale tooltip on hover */}
            <div className="mt-1 ml-12 text-xs text-gray-400 truncate group-hover:text-gray-500 transition-colors">
                {rationale}
            </div>
        </motion.div>
    );
}


