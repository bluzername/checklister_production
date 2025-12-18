'use client';

import React, { useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    TrendingUp,
    Database,
    Cpu,
    BarChart2,
    Target,
    Activity,
    GitBranch,
    Layers,
    Shield,
    Zap,
    CheckCircle,
    AlertTriangle,
    Info,
    XCircle,
    Filter,
    DollarSign
} from 'lucide-react';

// ============================================
// SYSTEM METRICS (Updated with Veto System results)
// ============================================

const SYSTEM_METRICS = {
    version: '3.0.0',
    lastUpdated: '2024-12-18',
    modelType: 'Veto-Based ML Filter',
    featureCount: 40,
    trainingSamples: 50096,
    signalTypes: ['Insider Buying', 'Politician Trades', 'Smart Money'],
    backtest: {
        totalSignals: 165,
        signalsTaken: 153,
        vetoRate: 7.3,
        winRate: 41.2,
        avgR: 0.269,
        profitFactor: 1.44,
        vetoPrecision: 83.3,
        baselineWinRate: 39.4,
        baselineProfitFactor: 1.34,
    },
    threshold: 60,
};

// ============================================
// SECTION COMPONENTS
// ============================================

function MetricCard({ label, value, unit = '%', change, isGood = true }: {
    label: string;
    value: number;
    unit?: string;
    change?: number;
    isGood?: boolean;
}) {
    return (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</div>
            <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold text-gray-900">{value.toFixed(1)}</span>
                <span className="text-sm text-gray-500">{unit}</span>
            </div>
            {change !== undefined && (
                <div className={`text-xs mt-1 ${isGood ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {change >= 0 ? '+' : ''}{change.toFixed(1)}{unit} vs baseline
                </div>
            )}
        </div>
    );
}

function ExpandableSection({ title, icon: Icon, children, defaultOpen = false }: {
    title: string;
    icon: React.ElementType;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-5 py-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 text-gray-600" />
                    <span className="font-medium text-gray-900">{title}</span>
                </div>
                {isOpen ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                )}
            </button>
            {isOpen && (
                <div className="px-5 py-4 bg-white border-t border-gray-200">
                    {children}
                </div>
            )}
        </div>
    );
}

function FeatureTable() {
    const featureCategories = [
        {
            category: 'Price vs Moving Averages',
            features: [
                { name: 'priceVsSma20', description: 'Price distance from 20-day SMA (%)' },
                { name: 'priceVsSma50', description: 'Price distance from 50-day SMA (%)' },
                { name: 'priceVsEma9', description: 'Price distance from 9-day EMA (%)' },
                { name: 'sma20VsSma50', description: '20 SMA vs 50 SMA relationship (%)' },
                { name: 'ema9VsEma21', description: '9 EMA vs 21 EMA crossover (%)' },
            ]
        },
        {
            category: 'Position & Range',
            features: [
                { name: 'positionInRange', description: 'Position within 52-week range (0-1)' },
                { name: 'pullbackFromHigh', description: 'Distance from 52-week high (%)' },
                { name: 'bbPosition', description: 'Position within Bollinger Bands (0-1)' },
            ]
        },
        {
            category: 'Volatility & Volume',
            features: [
                { name: 'atrPercent', description: 'ATR as percentage of price' },
                { name: 'volumeRatio', description: 'Current volume vs 20-day average' },
                { name: 'volRegime', description: 'ATR percentile (volatility regime)' },
            ]
        },
        {
            category: 'Momentum Indicators',
            features: [
                { name: 'rsi14', description: 'Relative Strength Index (14-period)' },
                { name: 'momentum5', description: '5-day price momentum (%)' },
                { name: 'momentum10', description: '10-day price momentum (%)' },
                { name: 'momentum20', description: '20-day price momentum (%)' },
                { name: 'momentum60', description: '60-day price momentum (%)' },
                { name: 'momAccel5', description: 'Momentum acceleration (5d vs 10d)' },
                { name: 'momAccel10', description: 'Momentum acceleration (10d vs 20d)' },
            ]
        },
        {
            category: 'Trend & Pattern',
            features: [
                { name: 'smaSlope', description: '5-day slope of 20 SMA (%)' },
                { name: 'trendConsistency5', description: 'Bullish candles in last 5 days (%)' },
                { name: 'trendConsistency10', description: 'Bullish candles in last 10 days (%)' },
                { name: 'candleBodyRatio', description: 'Candle body vs total range' },
                { name: 'isBullish', description: 'Current candle is bullish (0/1)' },
                { name: 'isBreakout', description: 'Near 52-week high breakout (0/1)' },
            ]
        },
        {
            category: 'Binary Indicators',
            features: [
                { name: 'aboveSma20', description: 'Price above 20 SMA (0/1)' },
                { name: 'aboveSma50', description: 'Price above 50 SMA (0/1)' },
            ]
        },
        {
            category: 'Interaction Features',
            features: [
                { name: 'oversoldBounce', description: 'RSI < 40 AND above 50 SMA' },
                { name: 'overboughtWarning', description: 'RSI > 70 AND below 20 SMA' },
                { name: 'trendWithMom', description: 'Above 50 SMA AND momentum > 0' },
                { name: 'pullbackInUptrend', description: 'Above 50 SMA but below 20 SMA' },
                { name: 'breakoutWithVol', description: 'Breakout with high volume' },
                { name: 'lowVolBreakout', description: 'Breakout with low volume (warning)' },
                { name: 'highVolConsolidation', description: 'High volume during consolidation' },
                { name: 'acceleratingUp', description: 'Positive momentum accelerating' },
                { name: 'deceleratingDown', description: 'Negative momentum slowing' },
                { name: 'meanRevScore', description: 'Mean reversion signal strength' },
            ]
        },
        {
            category: 'Market Context (SPY)',
            features: [
                { name: 'spyTrend', description: 'SPY above 50 SMA (market uptrend)' },
                { name: 'spyMomentum', description: 'SPY 20-day momentum (%)' },
                { name: 'spyVolRegime', description: 'SPY volatility percentile' },
                { name: 'relativeStrength', description: 'Stock momentum vs SPY momentum' },
            ]
        },
    ];

    return (
        <div className="space-y-4">
            {featureCategories.map((cat) => (
                <div key={cat.category}>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">{cat.category}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {cat.features.map((f) => (
                            <div key={f.name} className="flex items-start gap-2 text-sm">
                                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 font-mono whitespace-nowrap">
                                    {f.name}
                                </code>
                                <span className="text-gray-600">{f.description}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ============================================
// MAIN COMPONENT
// ============================================

export function MethodologyTab() {
    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                    <span>System Documentation</span>
                    <span className="text-gray-300">|</span>
                    <span>v{SYSTEM_METRICS.version}</span>
                    <span className="text-gray-300">|</span>
                    <span>Updated {SYSTEM_METRICS.lastUpdated}</span>
                </div>
                <h1 className="text-2xl font-semibold text-gray-900 mb-2">
                    How the Veto System Works
                </h1>
                <p className="text-gray-600">
                    A machine learning-based timing filter for swing trading signals. You provide the stock
                    picks (from insider buying, politician trades, etc.), and the system evaluates whether
                    it&apos;s a good time to enter - or vetoes bad timing with high confidence.
                </p>
            </div>

            {/* Key Concept Banner */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 mb-8">
                <div className="flex items-start gap-4">
                    <div className="bg-blue-100 rounded-lg p-2">
                        <Filter className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-gray-900 mb-1">The Veto Philosophy</h2>
                        <p className="text-sm text-gray-700 mb-3">
                            The system doesn&apos;t try to find winners - <strong>you</strong> find them through your
                            research (insider buying signals, politician trades, etc.). The ML model&apos;s job is
                            simpler: <strong>filter out bad timing</strong> with high confidence.
                        </p>
                        <div className="flex flex-wrap gap-4 text-sm">
                            <div className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-emerald-500" />
                                <span className="text-gray-700">Your signal + Good timing = PROCEED</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <XCircle className="w-4 h-4 text-red-500" />
                                <span className="text-gray-700">Your signal + Bad timing = VETO</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Backtest Performance Summary */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 mb-8">
                <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-5 h-5 text-gray-600" />
                    <h2 className="font-medium text-gray-900">Backtest Performance (6 months, 165 insider signals)</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <MetricCard
                        label="Win Rate"
                        value={SYSTEM_METRICS.backtest.winRate}
                        change={SYSTEM_METRICS.backtest.winRate - SYSTEM_METRICS.backtest.baselineWinRate}
                    />
                    <MetricCard
                        label="Avg R per Trade"
                        value={SYSTEM_METRICS.backtest.avgR}
                        unit="R"
                    />
                    <MetricCard
                        label="Profit Factor"
                        value={SYSTEM_METRICS.backtest.profitFactor}
                        unit="x"
                        change={SYSTEM_METRICS.backtest.profitFactor - SYSTEM_METRICS.backtest.baselineProfitFactor}
                    />
                    <MetricCard
                        label="Veto Precision"
                        value={SYSTEM_METRICS.backtest.vetoPrecision}
                    />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-600">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                        <span>Veto Threshold: P(loss) &gt; {SYSTEM_METRICS.threshold}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span>{SYSTEM_METRICS.featureCount} Technical Features</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                        <span>{SYSTEM_METRICS.backtest.vetoRate}% of signals vetoed</span>
                    </div>
                </div>
            </div>

            {/* System Flow */}
            <div className="mb-8">
                <h2 className="text-lg font-medium text-gray-900 mb-4">How It Works</h2>
                <div className="grid md:grid-cols-4 gap-4">
                    {[
                        { icon: TrendingUp, title: 'You Find Signal', desc: 'Insider buying, politician trade, or other catalyst' },
                        { icon: Database, title: 'System Analyzes', desc: '40 technical features computed from OHLCV + SPY' },
                        { icon: Filter, title: 'ML Evaluates Timing', desc: 'Model predicts P(loss) for current conditions' },
                        { icon: Target, title: 'Trade Plan', desc: 'If not vetoed: Stop loss + 3 profit targets' },
                    ].map((step, i) => (
                        <div key={step.title} className="relative">
                            <div className="bg-white border border-gray-200 rounded-lg p-4 h-full">
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600">
                                        {i + 1}
                                    </div>
                                    <step.icon className="w-4 h-4 text-gray-500" />
                                </div>
                                <h3 className="font-medium text-gray-900 text-sm mb-1">{step.title}</h3>
                                <p className="text-xs text-gray-500">{step.desc}</p>
                            </div>
                            {i < 3 && (
                                <div className="hidden md:block absolute top-1/2 -right-2 w-4 text-gray-300">
                                    <ChevronRight className="w-4 h-4" />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Detailed Sections */}
            <div className="space-y-4">
                {/* Signal Sources */}
                <ExpandableSection title="Signal Sources (Your Edge)" icon={TrendingUp} defaultOpen>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            The system is designed to work with high-conviction &quot;soft signals&quot; that you discover
                            through your own research. These signals have informational edge but uncertain timing.
                        </p>

                        <div className="grid md:grid-cols-3 gap-4">
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-emerald-500" />
                                    Insider Buying
                                </h4>
                                <p className="text-xs text-gray-600">
                                    Corporate insiders (CEOs, directors) buying their own stock.
                                    They know the business best.
                                </p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-blue-500" />
                                    Politician Trades
                                </h4>
                                <p className="text-xs text-gray-600">
                                    Congressional trading disclosures. Often have advance knowledge
                                    of legislation and contracts.
                                </p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 text-sm mb-2 flex items-center gap-2">
                                    <BarChart2 className="w-4 h-4 text-amber-500" />
                                    Smart Money
                                </h4>
                                <p className="text-xs text-gray-600">
                                    Hedge fund 13F filings, unusual options activity, or
                                    institutional accumulation patterns.
                                </p>
                            </div>
                        </div>

                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                                <Info className="w-4 h-4 text-blue-600 mt-0.5" />
                                <div className="text-sm text-blue-800">
                                    <strong>Why this approach?</strong> These signals have proven alpha but
                                    uncertain timing. The ML veto filters out entries when technical
                                    conditions suggest the trade is likely to fail despite the signal.
                                </div>
                            </div>
                        </div>
                    </div>
                </ExpandableSection>

                {/* Feature Engineering */}
                <ExpandableSection title={`Technical Features (${SYSTEM_METRICS.featureCount} Features)`} icon={Layers}>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            The system computes {SYSTEM_METRICS.featureCount} technical features from OHLCV price data
                            and SPY market context. All features are &quot;point-in-time safe&quot; - computed using only
                            data available at the decision timestamp (no lookahead bias).
                        </p>
                        <FeatureTable />
                    </div>
                </ExpandableSection>

                {/* ML Model */}
                <ExpandableSection title="The Veto Model" icon={Cpu}>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            A logistic regression model predicts the probability that a trade will result in a loss.
                            If P(loss) exceeds the veto threshold, the signal is rejected.
                        </p>

                        <div className="grid md:grid-cols-2 gap-4">
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 text-sm mb-2">Model Architecture</h4>
                                <table className="text-sm w-full">
                                    <tbody className="divide-y divide-gray-200">
                                        <tr>
                                            <td className="py-1.5 text-gray-500">Algorithm</td>
                                            <td className="py-1.5 text-gray-900 font-mono text-xs">Logistic Regression</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1.5 text-gray-500">Features</td>
                                            <td className="py-1.5 text-gray-900 font-mono text-xs">{SYSTEM_METRICS.featureCount} (OHLCV + SPY)</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1.5 text-gray-500">Training Samples</td>
                                            <td className="py-1.5 text-gray-900 font-mono text-xs">{SYSTEM_METRICS.trainingSamples.toLocaleString()}</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1.5 text-gray-500">Normalization</td>
                                            <td className="py-1.5 text-gray-900 font-mono text-xs">Z-score standardization</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1.5 text-gray-500">Veto Threshold</td>
                                            <td className="py-1.5 text-gray-900 font-mono text-xs">P(loss) &gt; {SYSTEM_METRICS.threshold}%</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 text-sm mb-2">Why Logistic Regression?</h4>
                                <ul className="text-sm text-gray-600 space-y-1.5">
                                    <li className="flex items-start gap-2">
                                        <CheckCircle className="w-3 h-3 text-emerald-500 mt-0.5" />
                                        <span>Well-calibrated probabilities (crucial for thresholding)</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <CheckCircle className="w-3 h-3 text-emerald-500 mt-0.5" />
                                        <span>Interpretable feature weights</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <CheckCircle className="w-3 h-3 text-emerald-500 mt-0.5" />
                                        <span>Robust to overfitting with limited signal</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <CheckCircle className="w-3 h-3 text-emerald-500 mt-0.5" />
                                        <span>Fast inference (runs in browser)</span>
                                    </li>
                                </ul>
                            </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 text-sm mb-2">Prediction Output</h4>
                            <p className="text-sm text-gray-600 mb-2">
                                The model outputs P(win), and we compute P(loss) = 1 - P(win). If P(loss) exceeds
                                the threshold, the trade is vetoed.
                            </p>
                            <div className="font-mono text-xs bg-gray-900 text-gray-100 p-3 rounded">
                                P(win) = sigmoid(w₀ + w₁·x₁ + w₂·x₂ + ... + w₄₀·x₄₀)<br/>
                                P(loss) = 1 - P(win)<br/>
                                VETO if P(loss) &gt; {SYSTEM_METRICS.threshold}%
                            </div>
                        </div>
                    </div>
                </ExpandableSection>

                {/* Veto Decision Logic */}
                <ExpandableSection title="Veto Decision Logic" icon={Shield}>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            The veto threshold was optimized via grid search to maximize timing value while
                            maintaining high veto precision.
                        </p>

                        <div className="bg-gray-50 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 text-sm mb-3">Decision Outcomes</h4>
                            <div className="space-y-2">
                                <div className="flex items-center gap-3 text-sm">
                                    <div className="w-24 font-medium text-gray-600">P(loss) &lt; 50%</div>
                                    <div className="flex-1 h-2 bg-emerald-500 rounded"></div>
                                    <div className="w-20 text-emerald-700 font-medium">PROCEED</div>
                                </div>
                                <div className="flex items-center gap-3 text-sm">
                                    <div className="w-24 font-medium text-gray-600">50-60%</div>
                                    <div className="flex-1 h-2 bg-amber-400 rounded"></div>
                                    <div className="w-20 text-amber-700 font-medium">CAUTION</div>
                                </div>
                                <div className="flex items-center gap-3 text-sm">
                                    <div className="w-24 font-medium text-gray-600">&gt; 60%</div>
                                    <div className="flex-1 h-2 bg-red-500 rounded"></div>
                                    <div className="w-20 text-red-700 font-medium">VETO</div>
                                </div>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-3 gap-4">
                            <div className="text-center p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                                <div className="text-2xl font-semibold text-emerald-700">
                                    {SYSTEM_METRICS.backtest.vetoPrecision}%
                                </div>
                                <div className="text-xs text-gray-600 mt-1">Veto Precision</div>
                                <div className="text-xs text-emerald-600 mt-0.5">
                                    Vetoed trades usually lose
                                </div>
                            </div>
                            <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
                                <div className="text-2xl font-semibold text-blue-700">
                                    {SYSTEM_METRICS.backtest.vetoRate}%
                                </div>
                                <div className="text-xs text-gray-600 mt-1">Veto Rate</div>
                                <div className="text-xs text-blue-600 mt-0.5">
                                    Low false positive rate
                                </div>
                            </div>
                            <div className="text-center p-4 bg-amber-50 rounded-lg border border-amber-200">
                                <div className="text-2xl font-semibold text-amber-700">
                                    +{(SYSTEM_METRICS.backtest.winRate - SYSTEM_METRICS.backtest.baselineWinRate).toFixed(1)}%
                                </div>
                                <div className="text-xs text-gray-600 mt-1">Win Rate Lift</div>
                                <div className="text-xs text-amber-600 mt-0.5">
                                    vs taking all signals
                                </div>
                            </div>
                        </div>

                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
                                <div className="text-sm text-amber-800">
                                    <strong>Conservative by design:</strong> The system vetoes only ~7% of signals.
                                    It&apos;s not trying to predict winners - it&apos;s catching the worst timing with
                                    high confidence.
                                </div>
                            </div>
                        </div>
                    </div>
                </ExpandableSection>

                {/* Trade Plan Generation */}
                <ExpandableSection title="Trade Plan Generation" icon={Target}>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            For signals that pass the veto filter, the system generates a complete trade plan
                            with stop loss and three profit targets.
                        </p>

                        <div className="grid md:grid-cols-2 gap-4">
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 text-sm mb-2">Stop Loss Calculation</h4>
                                <ul className="text-sm text-gray-600 space-y-1.5">
                                    <li><strong>Method:</strong> ATR-based stop</li>
                                    <li><strong>Formula:</strong> Entry - 1.5 × ATR(14)</li>
                                    <li><strong>Typical distance:</strong> 3-5% below entry</li>
                                    <li><strong>Purpose:</strong> Defines 1R risk unit</li>
                                </ul>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-medium text-gray-900 text-sm mb-2">Profit Targets (Partial Exits)</h4>
                                <table className="text-sm w-full">
                                    <tbody className="divide-y divide-gray-200">
                                        <tr>
                                            <td className="py-1.5 text-gray-500">TP1 (33%)</td>
                                            <td className="py-1.5 text-gray-900">Entry + 2R</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1.5 text-gray-500">TP2 (33%)</td>
                                            <td className="py-1.5 text-gray-900">Entry + 3R</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1.5 text-gray-500">TP3 (34%)</td>
                                            <td className="py-1.5 text-gray-900">Entry + 4R</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="bg-gray-50 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 text-sm mb-2">Position Sizing</h4>
                            <p className="text-sm text-gray-600 mb-2">
                                With 1% account risk per trade:
                            </p>
                            <div className="font-mono text-xs bg-gray-900 text-gray-100 p-3 rounded">
                                Risk per share = Entry - Stop Loss<br/>
                                Position size = (Account × 1%) / Risk per share<br/>
                                <br/>
                                Example: $100,000 account, $50 entry, $47 stop<br/>
                                Risk/share = $3, Position = $1,000 / $3 = 333 shares
                            </div>
                        </div>
                    </div>
                </ExpandableSection>

                {/* Expected Returns */}
                <ExpandableSection title="Expected Performance" icon={BarChart2}>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            Based on backtesting with {SYSTEM_METRICS.backtest.totalSignals} insider signals
                            over 6 months, here are the expected returns:
                        </p>

                        <div className="bg-gray-50 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 text-sm mb-3">Annual Return Projections</h4>
                            <table className="text-sm w-full">
                                <thead className="border-b border-gray-200">
                                    <tr>
                                        <th className="py-2 text-left text-gray-500">Risk/Trade</th>
                                        <th className="py-2 text-left text-gray-500">Trades/Year</th>
                                        <th className="py-2 text-left text-gray-500">Expected Return</th>
                                        <th className="py-2 text-left text-gray-500">$100K Becomes</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    <tr>
                                        <td className="py-2 text-gray-700">0.5%</td>
                                        <td className="py-2 text-gray-700">~300</td>
                                        <td className="py-2 text-emerald-600 font-medium">~40%</td>
                                        <td className="py-2 text-gray-900 font-semibold">$140,000</td>
                                    </tr>
                                    <tr className="bg-blue-50">
                                        <td className="py-2 text-gray-700">1.0%</td>
                                        <td className="py-2 text-gray-700">~300</td>
                                        <td className="py-2 text-emerald-600 font-medium">~80%</td>
                                        <td className="py-2 text-gray-900 font-semibold">$180,000</td>
                                    </tr>
                                    <tr>
                                        <td className="py-2 text-gray-700">1.5%</td>
                                        <td className="py-2 text-gray-700">~300</td>
                                        <td className="py-2 text-emerald-600 font-medium">~120%</td>
                                        <td className="py-2 text-gray-900 font-semibold">$220,000</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4">
                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                                <h4 className="font-medium text-emerald-800 text-sm mb-1">Key Advantage</h4>
                                <p className="text-sm text-emerald-700">
                                    Profit Factor of {SYSTEM_METRICS.backtest.profitFactor.toFixed(2)} means
                                    you make ${(SYSTEM_METRICS.backtest.profitFactor).toFixed(2)} for every
                                    $1 lost. Sustainable edge over time.
                                </p>
                            </div>
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                <h4 className="font-medium text-amber-800 text-sm mb-1">Risk Warning</h4>
                                <p className="text-sm text-amber-700">
                                    Past backtest performance does not guarantee future results.
                                    Markets change, and edge can decay.
                                </p>
                            </div>
                        </div>
                    </div>
                </ExpandableSection>

                {/* Model Updates */}
                <ExpandableSection title="Model Maintenance" icon={GitBranch}>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600">
                            The model is periodically retrained and the veto threshold re-optimized
                            as market conditions evolve.
                        </p>

                        <div className="bg-gray-50 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 text-sm mb-2">Update Schedule</h4>
                            <table className="text-sm w-full">
                                <tbody className="divide-y divide-gray-200">
                                    <tr>
                                        <td className="py-1.5 text-gray-500">Training Data</td>
                                        <td className="py-1.5 text-gray-900">7 years of daily OHLCV (2018-2025)</td>
                                    </tr>
                                    <tr>
                                        <td className="py-1.5 text-gray-500">Model Retraining</td>
                                        <td className="py-1.5 text-gray-900">Quarterly with new market data</td>
                                    </tr>
                                    <tr>
                                        <td className="py-1.5 text-gray-500">Threshold Optimization</td>
                                        <td className="py-1.5 text-gray-900">Monthly grid search validation</td>
                                    </tr>
                                    <tr>
                                        <td className="py-1.5 text-gray-500">Performance Monitoring</td>
                                        <td className="py-1.5 text-gray-900">Continuous veto precision tracking</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </ExpandableSection>
            </div>

            {/* Disclaimer */}
            <div className="mt-8 p-4 bg-gray-100 border border-gray-200 rounded-lg">
                <h3 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-gray-600" />
                    Important Disclaimers
                </h3>
                <ul className="text-sm text-gray-600 space-y-1">
                    <li>This tool is for educational and informational purposes only.</li>
                    <li>Past backtest performance does not guarantee future results.</li>
                    <li>Always conduct your own research before making investment decisions.</li>
                    <li>The model is trained on historical data and may not perform in novel market conditions.</li>
                    <li>You are responsible for your own trades. This is not financial advice.</li>
                </ul>
            </div>

            {/* Footer */}
            <div className="mt-6 text-center text-xs text-gray-400">
                Veto System v{SYSTEM_METRICS.version} | {SYSTEM_METRICS.featureCount} features |
                Threshold: P(loss) &gt; {SYSTEM_METRICS.threshold}% | Updated {SYSTEM_METRICS.lastUpdated}
            </div>
        </div>
    );
}
