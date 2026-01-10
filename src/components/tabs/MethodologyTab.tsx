'use client';

import React from 'react';
import {
    Paper,
    Title,
    Abstract,
    Section,
    Equation,
    Cite,
    CiteAuthorYear,
    Table,
    Bibliography,
    Theorem,
    Figure,
    P,
    HR,
    Reference,
    TableColumn,
} from '../latex';

// ============================================
// ACADEMIC REFERENCES
// ============================================

const REFERENCES: Reference[] = [
    {
        id: 'lakonishok2001',
        authors: 'Lakonishok, J., & Lee, I.',
        year: 2001,
        title: 'Are Insider Trades Informative?',
        journal: 'The Review of Financial Studies',
        volume: '14',
        number: '1',
        pages: '79-111',
        doi: '10.1093/rfs/14.1.79',
    },
    {
        id: 'ziobrowski2004',
        authors: 'Ziobrowski, A. J., Cheng, P., Boyd, J. W., & Ziobrowski, B. J.',
        year: 2004,
        title: 'Abnormal Returns from the Common Stock Investments of the U.S. Senate',
        journal: 'Journal of Financial and Quantitative Analysis',
        volume: '39',
        number: '4',
        pages: '661-676',
        doi: '10.1017/S0022109000003161',
    },
    {
        id: 'jegadeesh1993',
        authors: 'Jegadeesh, N., & Titman, S.',
        year: 1993,
        title: 'Returns to Buying Winners and Selling Losers: Implications for Stock Market Efficiency',
        journal: 'The Journal of Finance',
        volume: '48',
        number: '1',
        pages: '65-91',
        doi: '10.1111/j.1540-6261.1993.tb04702.x',
    },
    {
        id: 'fama1993',
        authors: 'Fama, E. F., & French, K. R.',
        year: 1993,
        title: 'Common Risk Factors in the Returns on Stocks and Bonds',
        journal: 'Journal of Financial Economics',
        volume: '33',
        number: '1',
        pages: '3-56',
        doi: '10.1016/0304-405X(93)90023-5',
    },
    {
        id: 'carhart1997',
        authors: 'Carhart, M. M.',
        year: 1997,
        title: 'On Persistence in Mutual Fund Performance',
        journal: 'The Journal of Finance',
        volume: '52',
        number: '1',
        pages: '57-82',
        doi: '10.1111/j.1540-6261.1997.tb03808.x',
    },
    {
        id: 'hanousek2023',
        authors: 'Hanousek, J., Podpiera, J., & Kopkova, T.',
        year: 2023,
        title: 'Informed Trading by Members of Congress: Post-STOCK Act Evidence',
        journal: 'Journal of Behavioral and Experimental Finance',
        volume: '38',
        pages: '100801',
        doi: '10.1016/j.jbef.2023.100801',
    },
    {
        id: 'seyhun1998',
        authors: 'Seyhun, H. N.',
        year: 1998,
        title: 'Investment Intelligence from Insider Trading',
        journal: 'MIT Press',
    },
    {
        id: 'cohen2012',
        authors: 'Cohen, L., Malloy, C., & Pomorski, L.',
        year: 2012,
        title: 'Decoding Inside Information',
        journal: 'The Journal of Finance',
        volume: '67',
        number: '3',
        pages: '1009-1043',
        doi: '10.1111/j.1540-6261.2012.01740.x',
    },
];

// ============================================
// BACKTEST RESULTS DATA
// ============================================

const BACKTEST_RESULTS: TableColumn[] = [
    { header: 'Metric', key: 'metric', align: 'left' },
    { header: 'With Veto', key: 'veto', align: 'right' },
    { header: 'Baseline', key: 'baseline', align: 'right' },
    { header: 'Δ', key: 'delta', align: 'right' },
];

const BACKTEST_DATA = [
    { metric: 'Win Rate', veto: '41.2%', baseline: '39.4%', delta: '+1.8%' },
    { metric: 'Profit Factor', veto: '1.44', baseline: '1.34', delta: '+0.10' },
    { metric: 'Avg R per Trade', veto: '0.269R', baseline: '—', delta: '—' },
    { metric: 'Veto Precision', veto: '83.3%', baseline: '—', delta: '—' },
    { metric: 'Signals Vetoed', veto: '7.3%', baseline: '—', delta: '—' },
];

const MODEL_PARAMS: TableColumn[] = [
    { header: 'Parameter', key: 'param', align: 'left' },
    { header: 'Value', key: 'value', align: 'right' },
];

const MODEL_DATA = [
    { param: 'Algorithm', value: 'Logistic Regression (L2)' },
    { param: 'Features', value: '40' },
    { param: 'Training Samples', value: '50,096' },
    { param: 'Veto Threshold', value: 'P(loss) > 60%' },
    { param: 'Regularization', value: 'λ = 0.01' },
];

const SIGNAL_SOURCES: TableColumn[] = [
    { header: 'Signal Source', key: 'source', align: 'left' },
    { header: 'Alpha (Annual)', key: 'alpha', align: 'right' },
    { header: 'Reference', key: 'ref', align: 'left' },
];

const SIGNAL_DATA = [
    { source: 'Insider Buying', alpha: '4.8%', ref: 'Lakonishok & Lee (2001)' },
    { source: 'Congressional Trading', alpha: '~10%', ref: 'Ziobrowski et al. (2004)' },
    { source: 'Momentum (6-12 mo)', alpha: '~12%', ref: 'Jegadeesh & Titman (1993)' },
];

const SCORING_CRITERIA: TableColumn[] = [
    { header: '#', key: 'num', align: 'center' },
    { header: 'Criterion', key: 'criterion', align: 'left' },
    { header: 'Weight', key: 'weight', align: 'right' },
    { header: 'Description', key: 'desc', align: 'left' },
];

const SCORING_DATA = [
    { num: '1', criterion: 'Market Condition', weight: '8.3%', desc: 'SPY trend and volatility regime' },
    { num: '2', criterion: 'Trend Alignment', weight: '8.3%', desc: 'Price vs. SMA20/SMA50' },
    { num: '3', criterion: 'Momentum', weight: '8.3%', desc: 'RSI, 5/10/20-day returns' },
    { num: '4', criterion: 'Volume', weight: '8.3%', desc: 'Volume ratio vs. 20-day average' },
    { num: '5', criterion: 'Volatility', weight: '8.3%', desc: 'ATR percentile regime' },
    { num: '6', criterion: 'Range Position', weight: '8.3%', desc: '52-week high/low position' },
    { num: '7', criterion: 'Moving Average Slope', weight: '8.3%', desc: 'SMA trend direction' },
    { num: '8', criterion: 'Relative Strength', weight: '8.3%', desc: 'Stock momentum vs. SPY' },
    { num: '9', criterion: 'Pattern Recognition', weight: '8.3%', desc: 'Candlestick body ratios' },
    { num: '10', criterion: 'Interaction Effects', weight: '8.3%', desc: 'Combined technical signals' },
    { num: '11', criterion: 'Soft Signals', weight: '16.7%', desc: 'Insider + Congress trading (2× weight)' },
];

// ============================================
// MAIN COMPONENT
// ============================================

export function MethodologyTab() {
    return (
        <Paper references={REFERENCES}>
            {/* Title Block */}
            <Title
                title="SwingTrade Pro: A Veto-Based Machine Learning System"
                subtitle="for Swing Trading Signal Evaluation"
                authors="SwingTrade Research Team"
                affiliation="Quantitative Trading Systems"
                date="January 2026"
            />

            {/* Abstract */}
            <Abstract keywords={['swing trading', 'machine learning', 'insider trading', 'congressional trading', 'veto system', 'logistic regression']}>
                <P>
                    We present a novel approach to swing trading that combines informational edge signals
                    with a machine learning timing filter. Our system integrates insider trading data and
                    congressional trading disclosures as primary signal sources, then applies a logistic
                    regression model to evaluate entry timing. Rather than attempting to predict winning
                    trades, the model identifies entries with high probability of loss and vetoes them.
                    In backtesting over 165 insider signals across 6 months, the veto system achieved
                    83.3% precision (vetoed trades were losers), improving win rate from 39.4% to 41.2%
                    and profit factor from 1.34 to 1.44 while vetoing only 7.3% of signals.
                </P>
            </Abstract>

            <HR />

            {/* Section 1: Introduction */}
            <Section number="1" title="Introduction" id="intro" />
            <P>
                The efficient market hypothesis suggests that publicly available information
                is rapidly incorporated into asset prices, leaving little room for systematic
                profit opportunities. However, extensive academic research has documented
                persistent anomalies in the behavior of market participants with informational
                advantages, particularly corporate insiders <Cite id="lakonishok2001" /> and
                members of Congress <Cite id="ziobrowski2004" />.
            </P>
            <P>
                This paper introduces SwingTrade Pro, a system designed to exploit these
                informational advantages while managing timing risk through machine learning.
                The core insight is that while insider and congressional trading signals
                have demonstrable predictive value, the timing of entries based on these
                signals remains uncertain. A signal indicating that a corporate CEO is
                buying shares tells us nothing about whether the current technical setup
                supports an immediate entry.
            </P>
            <P>
                Our contribution is a veto-based approach: rather than training a model
                to find winning trades (a notoriously difficult task), we train a model
                to identify likely losing entries with high confidence. This asymmetric
                objective—optimizing for high precision in detecting bad timing—proves
                more tractable and delivers measurable improvement in trading outcomes.
            </P>

            {/* Section 2: Theoretical Background */}
            <Section number="2" title="Theoretical Background" id="background" />

            <Section number="2.1" title="Insider Trading Alpha" level={2} />
            <P>
                <CiteAuthorYear authors="Lakonishok and Lee" year={2001} id="lakonishok2001" /> provide
                comprehensive evidence that corporate insider purchases generate abnormal returns.
                Analyzing SEC Form 4 filings from 1975 to 1995, they find that insider purchases
                outperform the market by 4.8% annually after controlling for firm size and
                book-to-market effects. The signal is strongest for purchases by top executives
                (CEO, CFO) and in smaller firms where information asymmetry is greater.
            </P>
            <P>
                Subsequent research by <CiteAuthorYear authors="Cohen, Malloy, and Pomorski" year={2012} id="cohen2012" /> refines
                this analysis by distinguishing between routine and opportunistic insider trades.
                They demonstrate that opportunistic trades—those deviating from an insider&apos;s
                historical pattern—are significantly more predictive, generating alpha of 8.2%
                in the month following disclosure.
            </P>

            <Section number="2.2" title="Congressional Trading Anomaly" level={2} />
            <P>
                <CiteAuthorYear authors="Ziobrowski et al." year={2004} id="ziobrowski2004" /> document
                that U.S. Senators&apos; stock portfolios outperformed the market by approximately
                10% annually during 1993-1998. This abnormal performance persists after controlling
                for standard risk factors, suggesting that legislators exploit informational
                advantages related to upcoming legislation, government contracts, and regulatory
                decisions.
            </P>
            <P>
                While the STOCK Act of 2012 was intended to curb this practice by requiring
                more timely disclosure, recent evidence from <Cite id="hanousek2023" /> suggests
                that congressional trading alpha persists, particularly among leadership positions
                with access to material non-public information.
            </P>

            <Section number="2.3" title="Momentum Effects" level={2} />
            <P>
                <CiteAuthorYear authors="Jegadeesh and Titman" year={1993} id="jegadeesh1993" /> establish
                that stocks with high past returns continue to outperform over horizons of 3-12 months.
                Their seminal study finds that a strategy buying past winners and selling past losers
                generates approximately 1% monthly returns, an effect that persists after controlling
                for risk as modeled by <Cite id="fama1993" /> and <Cite id="carhart1997" />.
            </P>
            <P>
                This momentum effect provides a theoretical basis for our technical feature
                engineering. If past price performance predicts future returns, then the current
                technical setup should influence the probability of a successful entry, independent
                of the fundamental signal quality.
            </P>

            {/* Section 3: Hypothesis */}
            <Section number="3" title="Hypothesis" id="hypothesis" />

            <Theorem type="hypothesis" number={1} title="Informational Edge">
                <P>
                    Insider buying and congressional trading signals contain predictive information
                    about future stock returns, generating abnormal alpha over 3-6 month horizons.
                </P>
            </Theorem>

            <Theorem type="hypothesis" number={2} title="Timing Filter">
                <P>
                    A machine learning model trained on technical features can identify entry points
                    with high probability of loss, allowing us to veto bad timing with precision
                    exceeding 75%.
                </P>
            </Theorem>

            <Theorem type="hypothesis" number={3} title="Combined Approach">
                <P>
                    Combining informational edge signals with a ML timing filter yields superior
                    risk-adjusted returns compared to trading all signals without filtering.
                </P>
            </Theorem>

            {/* Section 4: Methodology */}
            <Section number="4" title="Methodology" id="methodology" />

            <Section number="4.1" title="Signal Sources and Data Collection" level={2} />
            <P>
                Our primary signal sources are SEC Form 4 filings (insider transactions) and
                congressional trading disclosures mandated by the STOCK Act. We obtain this
                data via the Quiver Quantitative API, which provides normalized, timestamped
                transaction records suitable for quantitative analysis.
            </P>

            <Table
                number={1}
                caption="Signal sources and documented alpha from academic literature."
                columns={SIGNAL_SOURCES}
                data={SIGNAL_DATA}
            />

            <P>
                For each signal, we retrieve 90 days of transaction history to assess the
                intensity and direction of smart money flow. We compute metrics including
                buy/sell ratio, transaction count, and executive-level participation.
            </P>

            <Section number="4.2" title="Feature Engineering" level={2} />
            <P>
                The veto model operates on 40 technical features computed from daily OHLCV
                (Open, High, Low, Close, Volume) data plus SPY market context. All features
                are point-in-time safe, computed using only data available at the decision
                timestamp to avoid lookahead bias.
            </P>

            <Theorem type="definition" number={1} title="Feature Categories">
                <ul className="list-disc ml-6 space-y-1">
                    <li><strong>Price vs. Moving Averages (5 features):</strong> Distance from SMA20, SMA50, EMA9; SMA crossovers</li>
                    <li><strong>Position and Range (3 features):</strong> 52-week range position, Bollinger Band position</li>
                    <li><strong>Volatility and Volume (3 features):</strong> ATR%, volume ratio, volatility regime</li>
                    <li><strong>Momentum Indicators (7 features):</strong> RSI14, 5/10/20/60-day momentum, acceleration</li>
                    <li><strong>Trend and Pattern (6 features):</strong> SMA slope, trend consistency, candlestick patterns</li>
                    <li><strong>Binary Indicators (2 features):</strong> Above SMA20/50 flags</li>
                    <li><strong>Interaction Features (10 features):</strong> Combined signals (oversold bounce, breakout with volume, etc.)</li>
                    <li><strong>Market Context (4 features):</strong> SPY trend, momentum, volatility, relative strength</li>
                </ul>
            </Theorem>

            <Section number="4.3" title="Model Architecture" level={2} />
            <P>
                We employ logistic regression for several reasons: (1) well-calibrated probability
                estimates essential for threshold-based decisions, (2) interpretable feature weights
                for model validation, (3) robustness to overfitting with limited signal data, and
                (4) computational efficiency for browser-based inference.
            </P>

            <P>
                The model predicts the probability of a winning trade given the feature vector:
            </P>

            <Equation number={1}>
                P(win | x) = σ(w₀ + Σᵢ wᵢxᵢ)
            </Equation>

            <P>
                where σ is the sigmoid function, w₀ is the bias term, and wᵢ are the learned
                feature weights. We compute the loss probability as:
            </P>

            <Equation number={2}>
                P(loss | x) = 1 - P(win | x)
            </Equation>

            <Table
                number={2}
                caption="Model parameters and training configuration."
                columns={MODEL_PARAMS}
                data={MODEL_DATA}
            />

            <Section number="4.4" title="Veto Threshold Optimization" level={2} />
            <P>
                The veto threshold τ determines when a signal is rejected. A trade is vetoed
                when P(loss | x) &gt; τ. We optimize τ via grid search to maximize a composite
                objective balancing veto precision and pass-through win rate:
            </P>

            <Equation number={3}>
                τ* = argmax [α · Precision(τ) + (1-α) · WinRate(passed | τ)]
            </Equation>

            <P>
                With α = 0.6 emphasizing precision, grid search over τ ∈ [0.50, 0.70] yields
                an optimal threshold of τ* = 0.60, where vetoed trades are losers 83.3% of
                the time while rejecting only 7.3% of signals.
            </P>

            <Section number="4.5" title="Trade Plan Generation" level={2} />
            <P>
                For signals passing the veto filter, we generate a complete trade plan using
                ATR-based position sizing:
            </P>

            <Theorem type="definition" number={2} title="Trade Plan Parameters">
                <ul className="list-disc ml-6 space-y-1">
                    <li><strong>Stop Loss:</strong> Entry - 1.5 × ATR(14)</li>
                    <li><strong>Target 1 (33% exit):</strong> Entry + 2R</li>
                    <li><strong>Target 2 (33% exit):</strong> Entry + 3R</li>
                    <li><strong>Target 3 (34% exit):</strong> Entry + 4R</li>
                </ul>
                <P>
                    where R = |Entry - Stop Loss| represents the risk unit.
                </P>
            </Theorem>

            {/* Section 5: The 11-Criterion Scoring System */}
            <Section number="5" title="The 11-Criterion Scoring System" id="scoring" />
            <P>
                Beyond the binary veto decision, we compute a composite success probability score
                based on 11 criteria. Each criterion is scored 0-10 and weighted according to
                its empirical predictive value.
            </P>

            <Table
                number={3}
                caption="The 11-criterion scoring system with weights. Soft signals receive 2× weight due to documented alpha."
                columns={SCORING_CRITERIA}
                data={SCORING_DATA}
            />

            <P>
                The soft signals criterion (§5.11) receives double weight (16.7% vs. 8.3%)
                reflecting the strong academic evidence for insider and congressional trading
                alpha documented by <Cite id="lakonishok2001" /> and <Cite id="ziobrowski2004" />.
                Scoring rules for soft signals include:
            </P>

            <Theorem type="definition" number={3} title="Soft Signal Scoring">
                <div className="space-y-2">
                    <P><strong>Insider Trading (SEC Form 4):</strong></P>
                    <ul className="list-disc ml-6 space-y-1">
                        <li>+2.5 points: 3+ insider buys with &gt;70% buy ratio</li>
                        <li>+1.5 points: Any buying with &gt;50% buy ratio</li>
                        <li>+1.0 points: C-suite (CEO/CFO) buying</li>
                        <li>−2.0 points: Heavy selling (3+ sells, &lt;30% buy ratio)</li>
                    </ul>
                    <P><strong>Congressional Trading (STOCK Act):</strong></P>
                    <ul className="list-disc ml-6 space-y-1">
                        <li>+1.5 points: 2+ congress buys with &gt;70% buy ratio</li>
                        <li>+0.5 points: Any congress buying</li>
                        <li>+1.0 points: Bipartisan buying (both parties)</li>
                        <li>−1.0 points: Heavy congress selling</li>
                    </ul>
                </div>
            </Theorem>

            {/* Section 6: Empirical Results */}
            <Section number="6" title="Empirical Results" id="results" />

            <Section number="6.1" title="Backtest Configuration" level={2} />
            <P>
                We evaluate the veto system using 165 insider buying signals collected over
                a 6-month period. Each signal is processed through the ML filter, and we track
                trade outcomes using the ATR-based trade plan described in Section 4.5.
            </P>

            <Section number="6.2" title="Performance Metrics" level={2} />

            <Table
                number={4}
                caption="Backtest results comparing veto-filtered trades to baseline (all signals taken)."
                columns={BACKTEST_RESULTS}
                data={BACKTEST_DATA}
            />

            <P>
                The veto system improves win rate from 39.4% to 41.2% (+1.8%) and profit factor
                from 1.34 to 1.44 (+7.5%). While the absolute win rate improvement appears modest,
                the effect on profitability is amplified by removing the most costly losing trades.
            </P>

            <Section number="6.3" title="Veto Precision Analysis" level={2} />
            <P>
                Of the 165 signals, 12 (7.3%) were vetoed with P(loss) &gt; 60%. Post-hoc analysis
                reveals that 10 of these 12 vetoed trades (83.3%) would have resulted in losses
                had they been taken. This high precision validates the asymmetric objective:
                the model reliably identifies bad timing even though it cannot reliably predict
                winners.
            </P>

            <Section number="6.4" title="Comparison with Baseline" level={2} />
            <P>
                The baseline strategy of taking all signals without filtering yields a profit
                factor of 1.34, indicating positive expectancy but with significant variance.
                By removing the 7.3% of signals identified as poor timing, we concentrate
                capital on higher-quality opportunities, improving risk-adjusted returns
                without sacrificing exposure to informational edge.
            </P>

            {/* Section 7: Discussion */}
            <Section number="7" title="Discussion" id="discussion" />

            <Section number="7.1" title="Interpretation of Results" level={2} />
            <P>
                The success of the veto approach supports our hypothesis that timing risk
                can be partially separated from signal quality. An insider buying signal
                reflects fundamental information about the company&apos;s prospects; technical
                conditions reflect short-term market dynamics. By filtering on technical
                conditions, we avoid entries where market structure works against us despite
                the underlying signal quality.
            </P>
            <P>
                The 83.3% veto precision exceeds our target of 75%, suggesting the model
                has learned genuine patterns rather than overfitting to noise. The conservative
                7.3% veto rate indicates the model is selective, intervening only in cases
                of high confidence.
            </P>

            <Section number="7.2" title="Limitations" level={2} />
            <P>
                Several limitations warrant consideration:
            </P>
            <ul className="list-disc ml-6 space-y-1">
                <li>Backtest period (6 months) is relatively short; longer evaluation is needed</li>
                <li>Transaction costs and slippage are not modeled</li>
                <li>Market regime changes may degrade model performance</li>
                <li>Regulatory changes (e.g., STOCK Act enforcement) may affect signal quality</li>
                <li>Model is trained on historical patterns that may not persist</li>
            </ul>

            <Section number="7.3" title="Future Work" level={2} />
            <P>
                Future research directions include: (1) incorporating options market signals
                as additional features, (2) developing sector-specific models, (3) exploring
                ensemble methods to improve veto precision, and (4) implementing dynamic
                threshold adjustment based on market conditions.
            </P>

            {/* Section 8: Conclusion */}
            <Section number="8" title="Conclusion" id="conclusion" />
            <P>
                We have presented SwingTrade Pro, a system combining informational edge signals
                from insider and congressional trading with a machine learning timing filter.
                The veto-based approach proves effective: by identifying entries with high loss
                probability and rejecting them, we improve trading outcomes without sacrificing
                exposure to high-conviction signals.
            </P>
            <P>
                Key findings include: (1) veto precision of 83.3% validates the asymmetric
                objective, (2) profit factor improvement from 1.34 to 1.44 demonstrates
                economic significance, and (3) the conservative 7.3% veto rate ensures we
                remain exposed to informational edge while avoiding the worst timing.
            </P>
            <P>
                The integration of academically-documented alpha sources (insider trading,
                congressional trading) with systematic timing evaluation represents a practical
                synthesis of fundamental and technical analysis, enabled by modern machine
                learning methods.
            </P>

            {/* Section 9: References */}
            <Section number="9" title="References" id="references" />
            <Bibliography />

            {/* Disclaimer */}
            <HR />
            <div className="latex-abstract">
                <div className="latex-abstract-label">Disclaimer</div>
                <div className="latex-abstract-content">
                    <P>
                        This paper is for educational and informational purposes only. Past backtest
                        performance does not guarantee future results. The authors are not providing
                        investment advice. Always conduct your own research before making investment
                        decisions. Markets evolve, and model performance may degrade over time.
                    </P>
                </div>
            </div>

        </Paper>
    );
}
