#!/usr/bin/env npx ts-node
/**
 * Evaluate Veto System
 *
 * Tests the veto-based ML approach using existing model and data.
 * Evaluates veto precision, timing value, and win rate lift at various thresholds.
 *
 * Usage:
 *   npx ts-node scripts/evaluate-veto.ts
 *   npx ts-node scripts/evaluate-veto.ts --model data/model-v2.json
 *   npx ts-node scripts/evaluate-veto.ts --data data/training-50k-v2.json
 *
 * Created: 2025-12-16
 */

import * as fs from 'fs';

// ============================================
// TYPES
// ============================================

interface Sample {
  ticker: string;
  signalDate: string;
  features: Record<string, number>;
  label: 0 | 1;
  realizedR: number;
  exitReason: string;
}

interface DataFile {
  metadata: {
    version: string;
    features: string[];
  };
  samples: Sample[];
}

interface ModelFile {
  version: string;
  features: string[];
  coefficients: {
    intercept: number;
    weights: Record<string, number>;
    featureMeans: Record<string, number>;
    featureStds: Record<string, number>;
  };
}

interface VetoMetrics {
  threshold: number;
  vetoRate: number;
  vetoPrecision: number;       // P(loss | vetoed)
  vetoRecall: number;          // P(vetoed | loss)
  nonVetoedWinRate: number;
  baselineWinRate: number;
  winRateLift: number;
  nonVetoedMeanR: number;
  baselineMeanR: number;
  timingValue: number;         // E[R | not vetoed] - E[R | all]
  vetoedCount: number;
  nonVetoedCount: number;
}

// ============================================
// MODEL PREDICTION
// ============================================

function sigmoid(z: number): number {
  if (z < -500) return 0;
  if (z > 500) return 1;
  return 1 / (1 + Math.exp(-z));
}

function predictWinProbability(
  features: Record<string, number>,
  model: ModelFile
): number {
  const { intercept, weights, featureMeans, featureStds } = model.coefficients;

  let z = intercept;
  for (const [name, weight] of Object.entries(weights)) {
    const value = features[name] ?? 0;
    const mean = featureMeans[name] ?? 0;
    const std = featureStds[name] ?? 1;
    const normalized = std > 0.0001 ? (value - mean) / std : 0;
    z += weight * normalized;
  }

  return sigmoid(z);
}

function predictLossProbability(
  features: Record<string, number>,
  model: ModelFile
): number {
  return 1 - predictWinProbability(features, model);
}

// ============================================
// VETO EVALUATION
// ============================================

function evaluateVetoThreshold(
  samples: Sample[],
  model: ModelFile,
  threshold: number
): VetoMetrics {
  let vetoed: Sample[] = [];
  let notVetoed: Sample[] = [];

  // Split samples based on veto threshold
  for (const sample of samples) {
    const pLoss = predictLossProbability(sample.features, model);
    if (pLoss > threshold) {
      vetoed.push(sample);
    } else {
      notVetoed.push(sample);
    }
  }

  // Baseline metrics (all samples)
  const baselineWins = samples.filter(s => s.label === 1).length;
  const baselineWinRate = baselineWins / samples.length;
  const baselineMeanR = samples.reduce((sum, s) => sum + s.realizedR, 0) / samples.length;

  // Vetoed metrics
  const vetoedLosses = vetoed.filter(s => s.label === 0).length;
  const vetoPrecision = vetoed.length > 0 ? vetoedLosses / vetoed.length : 0;

  // Veto recall: P(vetoed | loss)
  const totalLosses = samples.filter(s => s.label === 0).length;
  const vetoRecall = totalLosses > 0 ? vetoedLosses / totalLosses : 0;

  // Non-vetoed metrics
  const nonVetoedWins = notVetoed.filter(s => s.label === 1).length;
  const nonVetoedWinRate = notVetoed.length > 0 ? nonVetoedWins / notVetoed.length : 0;
  const nonVetoedMeanR = notVetoed.length > 0
    ? notVetoed.reduce((sum, s) => sum + s.realizedR, 0) / notVetoed.length
    : 0;

  return {
    threshold,
    vetoRate: vetoed.length / samples.length,
    vetoPrecision,
    vetoRecall,
    nonVetoedWinRate,
    baselineWinRate,
    winRateLift: nonVetoedWinRate - baselineWinRate,
    nonVetoedMeanR,
    baselineMeanR,
    timingValue: nonVetoedMeanR - baselineMeanR,
    vetoedCount: vetoed.length,
    nonVetoedCount: notVetoed.length,
  };
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

function formatR(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return sign + value.toFixed(3) + 'R';
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  // Parse arguments
  const args = process.argv.slice(2);
  let modelPath = 'data/model-v2.json';
  let dataPath = 'data/training-50k-v2.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      modelPath = args[++i];
    } else if (args[i] === '--data' && args[i + 1]) {
      dataPath = args[++i];
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('VETO SYSTEM EVALUATION');
  console.log('='.repeat(70));

  // Load model
  if (!fs.existsSync(modelPath)) {
    console.error(`\n[ERROR] Model not found: ${modelPath}`);
    console.error('Run: npm run train:model:v2');
    process.exit(1);
  }
  const model: ModelFile = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
  console.log(`\nModel: ${modelPath}`);
  console.log(`  Version: ${model.version}`);
  console.log(`  Features: ${model.features.length}`);

  // Load data
  if (!fs.existsSync(dataPath)) {
    console.error(`\n[ERROR] Data not found: ${dataPath}`);
    console.error('Run: npm run train:offline:v2:50k');
    process.exit(1);
  }
  const data: DataFile = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`\nData: ${dataPath}`);
  console.log(`  Samples: ${data.samples.length.toLocaleString()}`);
  console.log(`  Features: ${data.metadata.features.length}`);

  // Split into train/test for evaluation
  const shuffled = [...data.samples].sort(() => Math.random() - 0.5);
  const testStart = Math.floor(shuffled.length * 0.7);
  const testSamples = shuffled.slice(testStart);

  console.log(`\nUsing holdout set: ${testSamples.length.toLocaleString()} samples`);

  // Baseline stats
  const baselineWins = testSamples.filter(s => s.label === 1).length;
  const baselineLosses = testSamples.filter(s => s.label === 0).length;
  const baselineWinRate = baselineWins / testSamples.length;
  const baselineMeanR = testSamples.reduce((sum, s) => sum + s.realizedR, 0) / testSamples.length;

  console.log('\n' + '-'.repeat(70));
  console.log('BASELINE (No Veto)');
  console.log('-'.repeat(70));
  console.log(`  Total samples:   ${testSamples.length.toLocaleString()}`);
  console.log(`  Wins:            ${baselineWins.toLocaleString()} (${formatPercent(baselineWinRate)})`);
  console.log(`  Losses:          ${baselineLosses.toLocaleString()} (${formatPercent(1 - baselineWinRate)})`);
  console.log(`  Mean R:          ${formatR(baselineMeanR)}`);

  // Evaluate different thresholds
  console.log('\n' + '-'.repeat(70));
  console.log('VETO THRESHOLD ANALYSIS');
  console.log('-'.repeat(70));

  const thresholds = [0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85];
  const results: VetoMetrics[] = [];

  console.log('\n' + [
    'P(loss)>',
    'Veto%',
    'VetoPrecision',
    'VetoRecall',
    'WinRate↑',
    'TimingValue',
    'N(vetoed)',
  ].map(h => h.padEnd(12)).join(' '));
  console.log('-'.repeat(90));

  for (const threshold of thresholds) {
    const metrics = evaluateVetoThreshold(testSamples, model, threshold);
    results.push(metrics);

    const row = [
      threshold.toFixed(2),
      formatPercent(metrics.vetoRate),
      formatPercent(metrics.vetoPrecision),
      formatPercent(metrics.vetoRecall),
      (metrics.winRateLift >= 0 ? '+' : '') + formatPercent(metrics.winRateLift),
      formatR(metrics.timingValue),
      metrics.vetoedCount.toLocaleString(),
    ];
    console.log(row.map(v => v.padEnd(12)).join(' '));
  }

  // Detailed analysis for recommended threshold
  const recommendedThreshold = 0.70;
  const recommended = results.find(r => r.threshold === recommendedThreshold)!;

  console.log('\n' + '-'.repeat(70));
  console.log(`RECOMMENDED THRESHOLD: P(loss) > ${recommendedThreshold}`);
  console.log('-'.repeat(70));
  console.log(`
  Veto Rate:         ${formatPercent(recommended.vetoRate)} of signals rejected
  Veto Precision:    ${formatPercent(recommended.vetoPrecision)} of vetoed would have lost
  Veto Recall:       ${formatPercent(recommended.vetoRecall)} of losers caught

  Non-Vetoed Stats:
    Count:           ${recommended.nonVetoedCount.toLocaleString()} trades
    Win Rate:        ${formatPercent(recommended.nonVetoedWinRate)} (vs ${formatPercent(recommended.baselineWinRate)} baseline)
    Win Rate Lift:   ${recommended.winRateLift >= 0 ? '+' : ''}${formatPercent(recommended.winRateLift)}
    Mean R:          ${formatR(recommended.nonVetoedMeanR)} (vs ${formatR(recommended.baselineMeanR)} baseline)
    Timing Value:    ${formatR(recommended.timingValue)} per trade
`);

  // Success criteria evaluation
  console.log('-'.repeat(70));
  console.log('SUCCESS CRITERIA CHECK');
  console.log('-'.repeat(70));

  const criteria = [
    {
      name: 'Veto Precision > 65%',
      met: recommended.vetoPrecision > 0.65,
      value: formatPercent(recommended.vetoPrecision),
    },
    {
      name: 'Timing Value > +0.05R',
      met: recommended.timingValue > 0.05,
      value: formatR(recommended.timingValue),
    },
    {
      name: 'Win Rate Lift > +5pp',
      met: recommended.winRateLift > 0.05,
      value: (recommended.winRateLift >= 0 ? '+' : '') + formatPercent(recommended.winRateLift),
    },
  ];

  for (const c of criteria) {
    const status = c.met ? '✅' : '❌';
    console.log(`  ${status} ${c.name.padEnd(25)} ${c.value}`);
  }

  const allCriteriaMet = criteria.every(c => c.met);
  console.log(`\n  Overall: ${allCriteriaMet ? '✅ PASS - Veto system is viable' : '⚠️  PARTIAL - Some criteria not met'}`);

  // Expected value analysis
  console.log('\n' + '-'.repeat(70));
  console.log('EXPECTED VALUE ANALYSIS');
  console.log('-'.repeat(70));

  // Assume user has ~20 signals per month, with baseline 40% win rate
  const signalsPerMonth = 20;
  const vetoedPerMonth = Math.round(signalsPerMonth * recommended.vetoRate);
  const tradedPerMonth = signalsPerMonth - vetoedPerMonth;

  // Break-even win rate calculation (from plan)
  const avgWin = 2.0;  // Average win is ~2R (TP1 at 2R)
  const avgLoss = -1.0; // Average loss is -1R (stop loss)
  const breakEvenWinRate = Math.abs(avgLoss) / (avgWin + Math.abs(avgLoss));

  const baselineEV = baselineWinRate * avgWin + (1 - baselineWinRate) * avgLoss;
  const vetoedEV = recommended.nonVetoedWinRate * avgWin + (1 - recommended.nonVetoedWinRate) * avgLoss;

  console.log(`
  Assuming ${signalsPerMonth} signals/month:
    Vetoed:              ${vetoedPerMonth} signals (rejected)
    Traded:              ${tradedPerMonth} signals (accepted)

  Expected Value per Trade:
    Without veto:        ${formatR(baselineEV)} (baseline)
    With veto:           ${formatR(vetoedEV)} (non-vetoed only)
    Improvement:         ${formatR(vetoedEV - baselineEV)} per trade

  Monthly Impact (${tradedPerMonth} trades @ $1000 risk each):
    Without veto:        $${(baselineEV * signalsPerMonth * 1000).toFixed(0)}
    With veto:           $${(vetoedEV * tradedPerMonth * 1000).toFixed(0)}
`);

  // Exit reason breakdown for vetoed vs non-vetoed
  console.log('-'.repeat(70));
  console.log('EXIT REASON BREAKDOWN');
  console.log('-'.repeat(70));

  const vetoedSamples = testSamples.filter(s => predictLossProbability(s.features, model) > recommendedThreshold);
  const nonVetoedSamples = testSamples.filter(s => predictLossProbability(s.features, model) <= recommendedThreshold);

  const exitReasonCounts = (samples: Sample[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const s of samples) {
      counts[s.exitReason] = (counts[s.exitReason] || 0) + 1;
    }
    return counts;
  };

  const vetoedReasons = exitReasonCounts(vetoedSamples);
  const nonVetoedReasons = exitReasonCounts(nonVetoedSamples);

  console.log('\n  Vetoed Samples by Exit Reason:');
  for (const [reason, count] of Object.entries(vetoedReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason.padEnd(15)} ${count.toLocaleString().padStart(6)} (${formatPercent(count / vetoedSamples.length)})`);
  }

  console.log('\n  Non-Vetoed Samples by Exit Reason:');
  for (const [reason, count] of Object.entries(nonVetoedReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason.padEnd(15)} ${count.toLocaleString().padStart(6)} (${formatPercent(count / nonVetoedSamples.length)})`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('EVALUATION COMPLETE');
  console.log('='.repeat(70));
}

main().catch(console.error);
