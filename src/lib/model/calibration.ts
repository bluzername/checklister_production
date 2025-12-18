/**
 * Probability Calibration
 * Implements Platt scaling and isotonic regression for probability calibration
 */

/**
 * Platt scaling parameters
 */
export interface PlattParameters {
  a: number;
  b: number;
}

/**
 * Isotonic regression model
 */
export interface IsotonicModel {
  x: number[]; // Input probabilities (sorted)
  y: number[]; // Calibrated probabilities
}

/**
 * Calibrate probability using Platt scaling
 * Transforms uncalibrated scores via: p = 1 / (1 + exp(a*x + b))
 */
export function plattCalibrate(
  probability: number,
  params: PlattParameters
): number {
  const x = probability / 100; // Normalize to 0-1
  const calibrated = 1 / (1 + Math.exp(params.a * x + params.b));
  return calibrated * 100;
}

/**
 * Fit Platt scaling parameters using gradient descent
 */
export function fitPlattScaling(
  predictions: { probability: number; label: 0 | 1 }[],
  iterations: number = 1000,
  learningRate: number = 0.01
): PlattParameters {
  if (predictions.length === 0) {
    return { a: 1, b: 0 }; // Identity transformation
  }

  // Initialize parameters
  let a = -1;
  let b = 0;

  // Prior counts for regularization (Bayesian approach)
  const positives = predictions.filter(p => p.label === 1).length;
  const negatives = predictions.length - positives;
  const tp = positives + 1;
  const tn = negatives + 1;
  const targetNeg = 1 / (tn + 2);
  const targetPos = (tp + 1) / (tp + 2);

  for (let iter = 0; iter < iterations; iter++) {
    let gradA = 0;
    let gradB = 0;

    for (const pred of predictions) {
      const x = pred.probability / 100;
      const p = 1 / (1 + Math.exp(a * x + b));
      const target = pred.label === 1 ? targetPos : targetNeg;
      const error = p - target;
      
      gradA += error * x * p * (1 - p);
      gradB += error * p * (1 - p);
    }

    a -= learningRate * (gradA / predictions.length);
    b -= learningRate * (gradB / predictions.length);
  }

  return { a, b };
}

/**
 * Calibrate probability using isotonic regression
 * Applies piecewise constant interpolation
 */
export function isotonicCalibrate(
  probability: number,
  model: IsotonicModel
): number {
  if (model.x.length === 0) return probability;

  // Binary search for the appropriate interval
  let left = 0;
  let right = model.x.length - 1;

  if (probability <= model.x[0]) return model.y[0];
  if (probability >= model.x[right]) return model.y[right];

  while (left < right - 1) {
    const mid = Math.floor((left + right) / 2);
    if (model.x[mid] <= probability) {
      left = mid;
    } else {
      right = mid;
    }
  }

  // Linear interpolation between points
  const x0 = model.x[left];
  const x1 = model.x[right];
  const y0 = model.y[left];
  const y1 = model.y[right];

  if (x1 === x0) return y0;

  const t = (probability - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

/**
 * Fit isotonic regression model using Pool Adjacent Violators (PAV) algorithm
 */
export function fitIsotonicRegression(
  predictions: { probability: number; label: 0 | 1 }[]
): IsotonicModel {
  if (predictions.length === 0) {
    return { x: [], y: [] };
  }

  // Sort by predicted probability
  const sorted = [...predictions].sort((a, b) => a.probability - b.probability);

  // Initialize: each point is its own block
  const blocks: { sum: number; weight: number; start: number; end: number }[] = [];
  
  for (let i = 0; i < sorted.length; i++) {
    blocks.push({
      sum: sorted[i].label,
      weight: 1,
      start: i,
      end: i,
    });
  }

  // PAV: Pool adjacent violators
  let changed = true;
  while (changed) {
    changed = false;
    
    for (let i = 0; i < blocks.length - 1; i++) {
      const current = blocks[i];
      const next = blocks[i + 1];
      
      const currentMean = current.sum / current.weight;
      const nextMean = next.sum / next.weight;

      // If isotonicity is violated (current > next), merge blocks
      if (currentMean > nextMean) {
        current.sum += next.sum;
        current.weight += next.weight;
        current.end = next.end;
        blocks.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }

  // Create output model
  const x: number[] = [];
  const y: number[] = [];

  for (const block of blocks) {
    const calibratedProb = (block.sum / block.weight) * 100;
    
    // Add points at block boundaries
    x.push(sorted[block.start].probability);
    y.push(calibratedProb);
    
    if (block.end !== block.start) {
      x.push(sorted[block.end].probability);
      y.push(calibratedProb);
    }
  }

  return { x, y };
}

/**
 * Combined calibration: Platt + Isotonic ensemble
 */
export interface EnsembleCalibrator {
  platt: PlattParameters;
  isotonic: IsotonicModel;
  weights: { platt: number; isotonic: number };
}

/**
 * Calibrate using ensemble of methods
 */
export function ensembleCalibrate(
  probability: number,
  calibrator: EnsembleCalibrator
): number {
  const plattProb = plattCalibrate(probability, calibrator.platt);
  const isotonicProb = isotonicCalibrate(probability, calibrator.isotonic);
  
  return (
    plattProb * calibrator.weights.platt +
    isotonicProb * calibrator.weights.isotonic
  );
}

/**
 * Fit ensemble calibrator
 */
export function fitEnsembleCalibrator(
  predictions: { probability: number; label: 0 | 1 }[]
): EnsembleCalibrator {
  const platt = fitPlattScaling(predictions);
  const isotonic = fitIsotonicRegression(predictions);

  // Default equal weights; could optimize based on calibration error
  return {
    platt,
    isotonic,
    weights: { platt: 0.5, isotonic: 0.5 },
  };
}

/**
 * Evaluate calibration quality
 */
export function evaluateCalibration(
  predictions: { probability: number; label: 0 | 1 }[]
): {
  expectedCalibrationError: number;
  maxCalibrationError: number;
  brierScore: number;
  reliabilityDiagram: { bucket: string; avgPredicted: number; avgActual: number; count: number }[];
} {
  if (predictions.length === 0) {
    return {
      expectedCalibrationError: 0,
      maxCalibrationError: 0,
      brierScore: 0,
      reliabilityDiagram: [],
    };
  }

  // Create buckets for reliability diagram
  const numBuckets = 10;
  const buckets: { probSum: number; labelSum: number; count: number }[] = [];
  
  for (let i = 0; i < numBuckets; i++) {
    buckets.push({ probSum: 0, labelSum: 0, count: 0 });
  }

  let brierSum = 0;

  for (const pred of predictions) {
    const bucketIdx = Math.min(numBuckets - 1, Math.floor(pred.probability / 10));
    buckets[bucketIdx].probSum += pred.probability;
    buckets[bucketIdx].labelSum += pred.label;
    buckets[bucketIdx].count++;

    // Brier score
    const p = pred.probability / 100;
    brierSum += Math.pow(p - pred.label, 2);
  }

  // Calculate ECE and MCE
  let ece = 0;
  let mce = 0;
  const reliabilityDiagram: { bucket: string; avgPredicted: number; avgActual: number; count: number }[] = [];

  for (let i = 0; i < numBuckets; i++) {
    const bucket = buckets[i];
    if (bucket.count > 0) {
      const avgPredicted = bucket.probSum / bucket.count;
      const avgActual = (bucket.labelSum / bucket.count) * 100;
      const gap = Math.abs(avgPredicted - avgActual);
      
      ece += gap * (bucket.count / predictions.length);
      mce = Math.max(mce, gap);

      reliabilityDiagram.push({
        bucket: `${i * 10}-${(i + 1) * 10}%`,
        avgPredicted,
        avgActual,
        count: bucket.count,
      });
    }
  }

  return {
    expectedCalibrationError: ece,
    maxCalibrationError: mce,
    brierScore: brierSum / predictions.length,
    reliabilityDiagram,
  };
}

/**
 * Apply temperature scaling (simpler calibration method)
 */
export function temperatureScale(
  probability: number,
  temperature: number
): number {
  const logit = Math.log(probability / (100 - probability + 1e-10));
  const scaledLogit = logit / temperature;
  const calibrated = 1 / (1 + Math.exp(-scaledLogit));
  return calibrated * 100;
}

/**
 * Find optimal temperature by minimizing negative log-likelihood
 */
export function findOptimalTemperature(
  predictions: { probability: number; label: 0 | 1 }[]
): number {
  let bestTemp = 1;
  let bestNLL = Infinity;

  // Grid search over temperature values
  for (let temp = 0.1; temp <= 5.0; temp += 0.1) {
    let nll = 0;

    for (const pred of predictions) {
      const calibrated = temperatureScale(pred.probability, temp) / 100;
      const clampedProb = Math.max(1e-10, Math.min(1 - 1e-10, calibrated));

      if (pred.label === 1) {
        nll -= Math.log(clampedProb);
      } else {
        nll -= Math.log(1 - clampedProb);
      }
    }

    if (nll < bestNLL) {
      bestNLL = nll;
      bestTemp = temp;
    }
  }

  return bestTemp;
}

// ============================================
// UNIFIED CALIBRATION PARAMETERS
// ============================================

export type CalibrationMethod = 'none' | 'platt' | 'isotonic' | 'temperature' | 'ensemble';

/**
 * Unified calibration parameters that can be serialized with a model
 */
export interface CalibrationParams {
  method: CalibrationMethod;
  platt?: PlattParameters;
  isotonic?: IsotonicModel;
  temperature?: number;
  ensemble?: EnsembleCalibrator;
  fittedAt?: string;
  metrics?: {
    expectedCalibrationError: number;
    maxCalibrationError: number;
    brierScore: number;
  };
}

/**
 * Calibration comparison result
 */
export interface CalibrationComparison {
  method: CalibrationMethod;
  ece: number;
  mce: number;
  brierScore: number;
  params: CalibrationParams;
}

// ============================================
// AUTO-SELECT BEST CALIBRATION
// ============================================

/**
 * Automatically select the best calibration method
 * Fits all methods on training data and evaluates on validation data
 */
export function autoSelectCalibration(
  trainPredictions: { probability: number; label: 0 | 1 }[],
  valPredictions: { probability: number; label: 0 | 1 }[],
  verbose: boolean = false
): CalibrationParams {
  const comparisons: CalibrationComparison[] = [];

  // 1. No calibration (baseline)
  const noneEval = evaluateCalibration(valPredictions);
  comparisons.push({
    method: 'none',
    ece: noneEval.expectedCalibrationError,
    mce: noneEval.maxCalibrationError,
    brierScore: noneEval.brierScore,
    params: { method: 'none' },
  });

  // 2. Platt scaling
  const plattParams = fitPlattScaling(trainPredictions);
  const plattCalibrated = valPredictions.map(p => ({
    probability: plattCalibrate(p.probability, plattParams),
    label: p.label,
  }));
  const plattEval = evaluateCalibration(plattCalibrated);
  comparisons.push({
    method: 'platt',
    ece: plattEval.expectedCalibrationError,
    mce: plattEval.maxCalibrationError,
    brierScore: plattEval.brierScore,
    params: { method: 'platt', platt: plattParams },
  });

  // 3. Isotonic regression
  const isotonicModel = fitIsotonicRegression(trainPredictions);
  const isotonicCalibrated = valPredictions.map(p => ({
    probability: isotonicCalibrate(p.probability, isotonicModel),
    label: p.label,
  }));
  const isotonicEval = evaluateCalibration(isotonicCalibrated);
  comparisons.push({
    method: 'isotonic',
    ece: isotonicEval.expectedCalibrationError,
    mce: isotonicEval.maxCalibrationError,
    brierScore: isotonicEval.brierScore,
    params: { method: 'isotonic', isotonic: isotonicModel },
  });

  // 4. Temperature scaling
  const temperature = findOptimalTemperature(trainPredictions);
  const tempCalibrated = valPredictions.map(p => ({
    probability: temperatureScale(p.probability, temperature),
    label: p.label,
  }));
  const tempEval = evaluateCalibration(tempCalibrated);
  comparisons.push({
    method: 'temperature',
    ece: tempEval.expectedCalibrationError,
    mce: tempEval.maxCalibrationError,
    brierScore: tempEval.brierScore,
    params: { method: 'temperature', temperature },
  });

  // 5. Optimized ensemble
  const ensembleParams = fitOptimizedEnsembleCalibrator(trainPredictions, valPredictions);
  const ensembleCalibrated = valPredictions.map(p => ({
    probability: ensembleCalibrate(p.probability, ensembleParams),
    label: p.label,
  }));
  const ensembleEval = evaluateCalibration(ensembleCalibrated);
  comparisons.push({
    method: 'ensemble',
    ece: ensembleEval.expectedCalibrationError,
    mce: ensembleEval.maxCalibrationError,
    brierScore: ensembleEval.brierScore,
    params: { method: 'ensemble', ensemble: ensembleParams },
  });

  // Find best by ECE (primary) and Brier score (secondary)
  comparisons.sort((a, b) => {
    if (Math.abs(a.ece - b.ece) > 0.5) {
      return a.ece - b.ece;
    }
    return a.brierScore - b.brierScore;
  });

  if (verbose) {
    console.log('\nCalibration Method Comparison:');
    console.log('  Method        ECE      MCE    Brier');
    console.log('  ' + '-'.repeat(40));
    for (const c of comparisons) {
      console.log(
        `  ${c.method.padEnd(12)} ${c.ece.toFixed(2).padStart(6)}% ${c.mce.toFixed(2).padStart(6)}% ${c.brierScore.toFixed(4).padStart(8)}`
      );
    }
    console.log(`\nBest method: ${comparisons[0].method}`);
  }

  const best = comparisons[0];
  return {
    ...best.params,
    fittedAt: new Date().toISOString(),
    metrics: {
      expectedCalibrationError: best.ece,
      maxCalibrationError: best.mce,
      brierScore: best.brierScore,
    },
  };
}

// ============================================
// OPTIMIZED ENSEMBLE CALIBRATOR
// ============================================

/**
 * Fit ensemble calibrator with optimized weights
 * Uses grid search to find best Platt/Isotonic/Temperature mix
 */
export function fitOptimizedEnsembleCalibrator(
  trainPredictions: { probability: number; label: 0 | 1 }[],
  valPredictions: { probability: number; label: 0 | 1 }[]
): EnsembleCalibrator {
  // Fit individual methods
  const platt = fitPlattScaling(trainPredictions);
  const isotonic = fitIsotonicRegression(trainPredictions);

  // Grid search for optimal weights
  let bestWeights = { platt: 0.5, isotonic: 0.5 };
  let bestECE = Infinity;

  for (let plattWeight = 0; plattWeight <= 1.0; plattWeight += 0.1) {
    const isotonicWeight = 1 - plattWeight;

    const calibrated = valPredictions.map(p => {
      const plattProb = plattCalibrate(p.probability, platt);
      const isotonicProb = isotonicCalibrate(p.probability, isotonic);
      return {
        probability: plattProb * plattWeight + isotonicProb * isotonicWeight,
        label: p.label,
      };
    });

    const evaluation = evaluateCalibration(calibrated);
    if (evaluation.expectedCalibrationError < bestECE) {
      bestECE = evaluation.expectedCalibrationError;
      bestWeights = { platt: plattWeight, isotonic: isotonicWeight };
    }
  }

  return {
    platt,
    isotonic,
    weights: bestWeights,
  };
}

// ============================================
// UNIFIED CALIBRATION APPLY
// ============================================

/**
 * Apply calibration using stored parameters
 */
export function applyCalibration(
  probability: number,
  params: CalibrationParams
): number {
  switch (params.method) {
    case 'platt':
      if (!params.platt) return probability;
      return plattCalibrate(probability, params.platt);

    case 'isotonic':
      if (!params.isotonic) return probability;
      return isotonicCalibrate(probability, params.isotonic);

    case 'temperature':
      if (params.temperature === undefined) return probability;
      return temperatureScale(probability, params.temperature);

    case 'ensemble':
      if (!params.ensemble) return probability;
      return ensembleCalibrate(probability, params.ensemble);

    case 'none':
    default:
      return probability;
  }
}

// ============================================
// SERIALIZATION
// ============================================

/**
 * Serialize calibration parameters for storage
 */
export function serializeCalibrationParams(params: CalibrationParams): string {
  return JSON.stringify(params, null, 2);
}

/**
 * Deserialize calibration parameters
 */
export function deserializeCalibrationParams(json: string): CalibrationParams {
  return JSON.parse(json) as CalibrationParams;
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format calibration report
 */
export function formatCalibrationReport(params: CalibrationParams): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════╗');
  lines.push('║                    CALIBRATION REPORT                            ║');
  lines.push('╚══════════════════════════════════════════════════════════════════╝');

  lines.push(`\nMethod: ${params.method.toUpperCase()}`);

  if (params.fittedAt) {
    lines.push(`Fitted: ${params.fittedAt}`);
  }

  if (params.metrics) {
    lines.push('\n┌────────────────────────────────────────────────────────────────┐');
    lines.push('│                      METRICS                                   │');
    lines.push('├────────────────────────────────────────────────────────────────┤');
    lines.push(`│  Expected Cal. Error: ${params.metrics.expectedCalibrationError.toFixed(2)}%                                  │`);
    lines.push(`│  Max Cal. Error:      ${params.metrics.maxCalibrationError.toFixed(2)}%                                  │`);
    lines.push(`│  Brier Score:         ${params.metrics.brierScore.toFixed(4)}                                   │`);
    lines.push('└────────────────────────────────────────────────────────────────┘');
  }

  switch (params.method) {
    case 'platt':
      if (params.platt) {
        lines.push(`\nPlatt Parameters: a=${params.platt.a.toFixed(4)}, b=${params.platt.b.toFixed(4)}`);
      }
      break;

    case 'temperature':
      if (params.temperature !== undefined) {
        lines.push(`\nTemperature: ${params.temperature.toFixed(2)}`);
      }
      break;

    case 'ensemble':
      if (params.ensemble) {
        lines.push(`\nEnsemble Weights:`);
        lines.push(`  Platt:    ${(params.ensemble.weights.platt * 100).toFixed(0)}%`);
        lines.push(`  Isotonic: ${(params.ensemble.weights.isotonic * 100).toFixed(0)}%`);
      }
      break;

    case 'isotonic':
      if (params.isotonic) {
        lines.push(`\nIsotonic Model: ${params.isotonic.x.length} breakpoints`);
      }
      break;
  }

  return lines.join('\n');
}







