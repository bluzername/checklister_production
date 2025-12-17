'use client';

import React, { useState } from 'react';

type VetoVerdict = 'PROCEED' | 'CAUTION' | 'VETO';
type VetoConfidence = 'low' | 'medium' | 'high' | 'very_high';

interface VetoAnalysisBadgeProps {
  vetoed: boolean;
  pLoss: number;
  pWin: number;
  verdict: VetoVerdict;
  confidence: VetoConfidence;
  reasons: string[];
}

const verdictConfig: Record<VetoVerdict, {
  label: string;
  emoji: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  description: string;
}> = {
  PROCEED: {
    label: 'PROCEED',
    emoji: '✅',
    bgColor: 'bg-emerald-50',
    textColor: 'text-emerald-700',
    borderColor: 'border-emerald-200',
    description: 'ML model indicates favorable timing',
  },
  CAUTION: {
    label: 'CAUTION',
    emoji: '⚠️',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-200',
    description: 'Elevated risk - use tight risk management',
  },
  VETO: {
    label: 'VETO',
    emoji: '🚫',
    bgColor: 'bg-red-50',
    textColor: 'text-red-700',
    borderColor: 'border-red-200',
    description: 'ML model predicts unfavorable timing - skip this trade',
  },
};

const confidenceConfig: Record<VetoConfidence, {
  label: string;
  color: string;
}> = {
  low: { label: 'Low', color: 'text-gray-500' },
  medium: { label: 'Medium', color: 'text-amber-600' },
  high: { label: 'High', color: 'text-orange-600' },
  very_high: { label: 'Very High', color: 'text-red-600' },
};

export function VetoAnalysisBadge({
  vetoed,
  pLoss,
  pWin,
  verdict,
  confidence,
  reasons,
}: VetoAnalysisBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = verdictConfig[verdict];
  const confConfig = confidenceConfig[confidence];

  return (
    <div className={`rounded-xl border-2 ${config.borderColor} ${config.bgColor} overflow-hidden`}>
      {/* Clickable Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-white/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">{config.emoji}</span>
          <span className={`font-bold text-lg ${config.textColor}`}>
            ML Timing: {config.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-500">
            P(loss): <span className={`font-semibold ${pLoss > 0.5 ? 'text-red-600' : 'text-emerald-600'}`}>
              {(pLoss * 100).toFixed(0)}%
            </span>
          </div>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-200/50">
          {/* Probability Grid */}
          <div className="grid grid-cols-2 gap-4 pt-3">
            {/* P(Win) */}
            <div className="bg-white/50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">Win Probability</div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${
                  pWin >= 0.5 ? 'text-emerald-600' : 'text-red-500'
                }`}>
                  {(pWin * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${pWin >= 0.5 ? 'bg-emerald-500' : 'bg-red-400'}`}
                  style={{ width: `${pWin * 100}%` }}
                />
              </div>
            </div>

            {/* P(Loss) */}
            <div className="bg-white/50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">Loss Probability</div>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${
                  pLoss >= 0.6 ? 'text-red-600' : pLoss >= 0.5 ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {(pLoss * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    pLoss >= 0.6 ? 'bg-red-500' : pLoss >= 0.5 ? 'bg-amber-500' : 'bg-emerald-400'
                  }`}
                  style={{ width: `${pLoss * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Confidence & Verdict */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Confidence:</span>
              <span className={`font-semibold ${confConfig.color}`}>
                {confConfig.label}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Vetoed:</span>
              <span className={vetoed ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>
                {vetoed ? 'Yes' : 'No'}
              </span>
            </div>
          </div>

          {/* Reasons */}
          {reasons.length > 0 && (
            <div className="pt-2 border-t border-gray-200">
              <div className="text-xs text-gray-500 mb-2">Analysis Reasons:</div>
              <ul className="space-y-1">
                {reasons.slice(0, 5).map((reason, index) => (
                  <li key={index} className="text-xs text-gray-600 flex items-start gap-2">
                    <span className="text-gray-400 mt-0.5">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Description */}
          <div className="text-xs text-gray-500 italic pt-2 border-t border-gray-200">
            {config.description}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline version
 */
export function VetoAnalysisBadgeCompact({
  verdict,
  pLoss,
}: {
  verdict: VetoVerdict;
  pLoss: number;
}) {
  const config = verdictConfig[verdict];

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bgColor} ${config.borderColor} border`}>
      <span className="text-sm">{config.emoji}</span>
      <span className={`text-sm font-semibold ${config.textColor}`}>
        {verdict}
      </span>
      <span className="text-gray-400">|</span>
      <span className={`text-sm ${pLoss > 0.5 ? 'text-red-600' : 'text-emerald-600'}`}>
        P(loss): {(pLoss * 100).toFixed(0)}%
      </span>
    </div>
  );
}
