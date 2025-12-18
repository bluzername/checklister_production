/**
 * Portfolio Risk Manager
 * Implements risk budgeting, position sizing, and exposure controls
 */

import { MarketRegime } from '../market-regime/types';
import { AnalysisResult, PortfolioPosition } from '../types';

// ============================================
// TYPES
// ============================================

/**
 * Risk budget configuration
 */
export interface RiskBudget {
  maxRiskPerTrade: number; // % of equity per trade (e.g., 0.01 = 1%)
  maxTotalRisk: number; // Maximum total open risk (e.g., 0.06 = 6%)
  maxPerSector: number; // Maximum risk per sector (e.g., 0.02 = 2%)
  maxPositionsPerSector: number; // Maximum positions per sector
  maxCorrelatedRisk: number; // Maximum risk in correlated positions
  maxPerRegime: Record<MarketRegime, number>; // Regime-specific max risk
}

/**
 * Current portfolio exposure
 */
export interface CurrentExposure {
  totalRisk: number; // Sum of all position risks as % of equity
  openPositions: number;
  bySector: Record<string, { risk: number; count: number }>;
  byRegime: Record<MarketRegime, number>;
  availableRiskBudget: number;
}

/**
 * Position sizing result
 */
export interface PositionSizeResult {
  shares: number;
  dollarRisk: number;
  portfolioRiskPercent: number;
  positionValue: number;
  approved: boolean;
  rejectionReason?: string;
  warnings: string[];
}

/**
 * Risk analysis for a potential trade
 */
export interface TradeRiskAnalysis {
  canEnter: boolean;
  reason?: string;
  recommendedSize: PositionSizeResult;
  riskMetrics: {
    tradeRisk: number;
    newTotalRisk: number;
    sectorRisk: number;
    regimeAdjustment: number;
  };
}

// ============================================
// DEFAULT CONFIGURATIONS
// ============================================

/**
 * Default risk budget - conservative settings
 */
export const DEFAULT_RISK_BUDGET: RiskBudget = {
  maxRiskPerTrade: 0.01, // 1% per trade
  maxTotalRisk: 0.06, // 6% total portfolio risk
  maxPerSector: 0.02, // 2% per sector
  maxPositionsPerSector: 3,
  maxCorrelatedRisk: 0.03, // 3% in highly correlated positions
  maxPerRegime: {
    BULL: 0.08, // Allow more risk in bull markets
    CHOPPY: 0.05, // Reduce in choppy markets
    CRASH: 0.02, // Minimal risk in crash conditions
  },
};

/**
 * Aggressive risk budget - for experienced traders
 */
export const AGGRESSIVE_RISK_BUDGET: RiskBudget = {
  maxRiskPerTrade: 0.02, // 2% per trade
  maxTotalRisk: 0.10, // 10% total
  maxPerSector: 0.04, // 4% per sector
  maxPositionsPerSector: 5,
  maxCorrelatedRisk: 0.05,
  maxPerRegime: {
    BULL: 0.12,
    CHOPPY: 0.08,
    CRASH: 0.04,
  },
};

/**
 * Conservative risk budget - for capital preservation
 */
export const CONSERVATIVE_RISK_BUDGET: RiskBudget = {
  maxRiskPerTrade: 0.005, // 0.5% per trade
  maxTotalRisk: 0.03, // 3% total
  maxPerSector: 0.01, // 1% per sector
  maxPositionsPerSector: 2,
  maxCorrelatedRisk: 0.015,
  maxPerRegime: {
    BULL: 0.04,
    CHOPPY: 0.025,
    CRASH: 0.01,
  },
};

// ============================================
// PORTFOLIO RISK MANAGER CLASS
// ============================================

export class PortfolioRiskManager {
  private riskBudget: RiskBudget;
  private equity: number;
  private positions: PortfolioPosition[];
  private currentRegime: MarketRegime;

  constructor(
    equity: number,
    positions: PortfolioPosition[] = [],
    regime: MarketRegime = 'CHOPPY',
    riskBudget: RiskBudget = DEFAULT_RISK_BUDGET
  ) {
    this.equity = equity;
    this.positions = positions;
    this.currentRegime = regime;
    this.riskBudget = riskBudget;
  }

  /**
   * Update portfolio state
   */
  updateState(
    equity: number,
    positions: PortfolioPosition[],
    regime?: MarketRegime
  ): void {
    this.equity = equity;
    this.positions = positions;
    if (regime) this.currentRegime = regime;
  }

  /**
   * Calculate current portfolio exposure
   */
  calculateExposure(): CurrentExposure {
    const bySector: Record<string, { risk: number; count: number }> = {};
    const byRegime: Record<MarketRegime, number> = {
      BULL: 0,
      CHOPPY: 0,
      CRASH: 0,
    };

    let totalRisk = 0;

    for (const position of this.positions) {
      // Calculate position risk
      const currentPrice = position.current_price || position.buy_price;
      const analysis = position.analysis;
      const stopLoss = analysis?.trading_plan?.stop_loss?.price || position.buy_price * 0.93; // Default 7% stop
      
      const positionRisk = Math.abs(currentPrice - stopLoss) * position.quantity;
      const riskPercent = positionRisk / this.equity;
      totalRisk += riskPercent;

      // Track by sector
      const sector = analysis?.parameters?.['2_sector_condition']?.sector || 'Unknown';
      if (!bySector[sector]) {
        bySector[sector] = { risk: 0, count: 0 };
      }
      bySector[sector].risk += riskPercent;
      bySector[sector].count += 1;

      // Track by regime (use regime at entry)
      const regimeAtEntry = analysis?.market_regime?.regime || this.currentRegime;
      byRegime[regimeAtEntry] += riskPercent;
    }

    // Calculate available risk budget
    const regimeLimit = this.riskBudget.maxPerRegime[this.currentRegime];
    const availableRiskBudget = Math.max(0, Math.min(
      this.riskBudget.maxTotalRisk - totalRisk,
      regimeLimit - totalRisk
    ));

    return {
      totalRisk,
      openPositions: this.positions.length,
      bySector,
      byRegime,
      availableRiskBudget,
    };
  }

  /**
   * Calculate position size for a new trade
   */
  calculatePositionSize(
    entryPrice: number,
    stopLoss: number,
    sector?: string,
    analysis?: AnalysisResult
  ): PositionSizeResult {
    const warnings: string[] = [];
    const risk = Math.abs(entryPrice - stopLoss);

    if (risk <= 0) {
      return {
        shares: 0,
        dollarRisk: 0,
        portfolioRiskPercent: 0,
        positionValue: 0,
        approved: false,
        rejectionReason: 'Invalid stop loss - must be below entry price',
        warnings: [],
      };
    }

    const exposure = this.calculateExposure();

    // Calculate base position size based on risk per trade
    let maxRiskDollars = this.equity * this.riskBudget.maxRiskPerTrade;
    let riskAdjustment = 1.0;

    // Adjust for regime
    const regimeLimit = this.riskBudget.maxPerRegime[this.currentRegime];
    if (exposure.totalRisk + this.riskBudget.maxRiskPerTrade > regimeLimit) {
      riskAdjustment *= Math.max(0, (regimeLimit - exposure.totalRisk) / this.riskBudget.maxRiskPerTrade);
      warnings.push(`Regime (${this.currentRegime}) limits reducing size to ${(riskAdjustment * 100).toFixed(0)}%`);
    }

    // Adjust for sector concentration
    if (sector && exposure.bySector[sector]) {
      const sectorInfo = exposure.bySector[sector];
      if (sectorInfo.risk >= this.riskBudget.maxPerSector) {
        return {
          shares: 0,
          dollarRisk: 0,
          portfolioRiskPercent: 0,
          positionValue: 0,
          approved: false,
          rejectionReason: `Sector ${sector} at maximum risk (${(sectorInfo.risk * 100).toFixed(1)}%)`,
          warnings: [],
        };
      }
      if (sectorInfo.count >= this.riskBudget.maxPositionsPerSector) {
        return {
          shares: 0,
          dollarRisk: 0,
          portfolioRiskPercent: 0,
          positionValue: 0,
          approved: false,
          rejectionReason: `Maximum positions in sector ${sector} (${sectorInfo.count})`,
          warnings: [],
        };
      }
      // Reduce size if approaching sector limit
      const remainingSectorRisk = this.riskBudget.maxPerSector - sectorInfo.risk;
      if (remainingSectorRisk < this.riskBudget.maxRiskPerTrade) {
        riskAdjustment *= remainingSectorRisk / this.riskBudget.maxRiskPerTrade;
        warnings.push(`Sector concentration reducing size`);
      }
    }

    // Adjust for total portfolio risk
    if (exposure.availableRiskBudget < this.riskBudget.maxRiskPerTrade) {
      if (exposure.availableRiskBudget <= 0) {
        return {
          shares: 0,
          dollarRisk: 0,
          portfolioRiskPercent: 0,
          positionValue: 0,
          approved: false,
          rejectionReason: 'Portfolio at maximum risk capacity',
          warnings: [],
        };
      }
      riskAdjustment *= exposure.availableRiskBudget / this.riskBudget.maxRiskPerTrade;
      warnings.push('Near maximum portfolio risk, reducing size');
    }

    // Apply adjustment and calculate shares
    maxRiskDollars *= riskAdjustment;
    const shares = Math.floor(maxRiskDollars / risk);
    
    if (shares <= 0) {
      return {
        shares: 0,
        dollarRisk: 0,
        portfolioRiskPercent: 0,
        positionValue: 0,
        approved: false,
        rejectionReason: 'Calculated position too small',
        warnings,
      };
    }

    const actualRiskDollars = shares * risk;
    const portfolioRiskPercent = actualRiskDollars / this.equity;
    const positionValue = shares * entryPrice;

    // Final validation
    if (positionValue > this.equity * 0.25) {
      warnings.push('Position exceeds 25% of portfolio - consider reducing');
    }

    return {
      shares,
      dollarRisk: actualRiskDollars,
      portfolioRiskPercent,
      positionValue,
      approved: true,
      warnings,
    };
  }

  /**
   * Analyze risk for a potential trade
   */
  analyzeTradeRisk(
    analysis: AnalysisResult,
    entryPrice?: number
  ): TradeRiskAnalysis {
    const entry = entryPrice || analysis.current_price;
    const stopLoss = analysis.trading_plan.stop_loss.price;
    const sector = analysis.parameters['2_sector_condition'].sector;

    // Calculate position size
    const sizeResult = this.calculatePositionSize(entry, stopLoss, sector, analysis);

    // Can we enter this trade?
    const canEnter = sizeResult.approved && sizeResult.shares > 0;

    // Calculate risk metrics
    const exposure = this.calculateExposure();
    const tradeRisk = sizeResult.portfolioRiskPercent;
    const newTotalRisk = exposure.totalRisk + tradeRisk;
    const sectorRisk = (exposure.bySector[sector]?.risk || 0) + tradeRisk;

    return {
      canEnter,
      reason: sizeResult.rejectionReason,
      recommendedSize: sizeResult,
      riskMetrics: {
        tradeRisk,
        newTotalRisk,
        sectorRisk,
        regimeAdjustment: this.currentRegime === 'BULL' ? 1.0 : 
                          this.currentRegime === 'CHOPPY' ? 0.75 : 0.5,
      },
    };
  }

  /**
   * Get risk summary for display
   */
  getRiskSummary(): {
    equity: number;
    regime: MarketRegime;
    exposure: CurrentExposure;
    utilizationPercent: number;
    riskCapacity: string;
    recommendations: string[];
  } {
    const exposure = this.calculateExposure();
    const regimeLimit = this.riskBudget.maxPerRegime[this.currentRegime];
    const utilizationPercent = (exposure.totalRisk / regimeLimit) * 100;

    const recommendations: string[] = [];

    // Generate recommendations
    if (utilizationPercent > 80) {
      recommendations.push('Consider reducing position sizes or closing trades');
    }
    if (this.currentRegime === 'CRASH') {
      recommendations.push('Market in CRASH regime - minimize new positions');
    }
    if (this.currentRegime === 'CHOPPY') {
      recommendations.push('Choppy market - be selective, require higher conviction');
    }

    // Check sector concentration
    for (const [sector, info] of Object.entries(exposure.bySector)) {
      if (info.risk > this.riskBudget.maxPerSector * 0.8) {
        recommendations.push(`High concentration in ${sector} - avoid adding`);
      }
    }

    return {
      equity: this.equity,
      regime: this.currentRegime,
      exposure,
      utilizationPercent,
      riskCapacity: utilizationPercent < 50 ? 'HIGH' : 
                    utilizationPercent < 80 ? 'MODERATE' : 'LOW',
      recommendations,
    };
  }

  /**
   * Suggest position adjustments based on current risk
   */
  suggestAdjustments(): {
    trimPositions: { ticker: string; currentShares: number; suggestedTrim: number; reason: string }[];
    closePositions: { ticker: string; reason: string }[];
    generalRecommendations: string[];
  } {
    const trimPositions: { ticker: string; currentShares: number; suggestedTrim: number; reason: string }[] = [];
    const closePositions: { ticker: string; reason: string }[] = [];
    const generalRecommendations: string[] = [];

    const exposure = this.calculateExposure();

    // Check if we need to reduce overall risk
    const regimeLimit = this.riskBudget.maxPerRegime[this.currentRegime];
    if (exposure.totalRisk > regimeLimit) {
      const excessRisk = exposure.totalRisk - regimeLimit;
      generalRecommendations.push(
        `Portfolio ${(excessRisk * 100).toFixed(1)}% over risk limit for ${this.currentRegime} regime`
      );

      // Suggest trimming largest positions
      const sortedByRisk = [...this.positions].sort((a, b) => {
        const riskA = Math.abs((a.current_price || a.buy_price) - (a.analysis?.trading_plan?.stop_loss?.price || 0)) * a.quantity;
        const riskB = Math.abs((b.current_price || b.buy_price) - (b.analysis?.trading_plan?.stop_loss?.price || 0)) * b.quantity;
        return riskB - riskA;
      });

      let riskToReduce = excessRisk * this.equity;
      for (const position of sortedByRisk) {
        if (riskToReduce <= 0) break;
        
        const price = position.current_price || position.buy_price;
        const stopLoss = position.analysis?.trading_plan?.stop_loss?.price || position.buy_price * 0.93;
        const riskPerShare = Math.abs(price - stopLoss);
        const sharesToTrim = Math.ceil(riskToReduce / riskPerShare);
        const suggestedTrim = Math.min(sharesToTrim, Math.floor(position.quantity * 0.5));

        if (suggestedTrim > 0) {
          trimPositions.push({
            ticker: position.ticker,
            currentShares: position.quantity,
            suggestedTrim,
            reason: 'Reduce portfolio risk to regime limits',
          });
          riskToReduce -= suggestedTrim * riskPerShare;
        }
      }
    }

    // Check for positions at or below stop
    for (const position of this.positions) {
      const currentPrice = position.current_price || position.buy_price;
      const stopLoss = position.analysis?.trading_plan?.stop_loss?.price || position.buy_price * 0.93;
      
      if (currentPrice <= stopLoss) {
        closePositions.push({
          ticker: position.ticker,
          reason: `At or below stop loss ($${stopLoss.toFixed(2)})`,
        });
      }
    }

    return { trimPositions, closePositions, generalRecommendations };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate Kelly criterion position size
 * Kelly % = (Win% * AvgWin - Loss% * AvgLoss) / AvgWin
 */
export function calculateKellySize(
  winRate: number,
  avgWinR: number,
  avgLossR: number = 1
): number {
  const winPct = winRate / 100;
  const lossPct = 1 - winPct;
  
  const kelly = (winPct * avgWinR - lossPct * avgLossR) / avgWinR;
  
  // Use fractional Kelly (half or quarter) for safety
  return Math.max(0, kelly * 0.25);
}

/**
 * Calculate risk-adjusted position size
 */
export function calculateRiskAdjustedSize(
  equity: number,
  entryPrice: number,
  stopLoss: number,
  riskPercent: number,
  probability: number,
  regime: MarketRegime
): { shares: number; riskDollars: number } {
  let adjustedRisk = riskPercent;

  // Adjust for probability
  if (probability < 60) {
    adjustedRisk *= 0.5;
  } else if (probability < 70) {
    adjustedRisk *= 0.75;
  }

  // Adjust for regime
  if (regime === 'CHOPPY') {
    adjustedRisk *= 0.75;
  } else if (regime === 'CRASH') {
    adjustedRisk *= 0.5;
  }

  const riskDollars = equity * adjustedRisk;
  const risk = entryPrice - stopLoss;
  const shares = risk > 0 ? Math.floor(riskDollars / risk) : 0;

  return { shares, riskDollars: shares * risk };
}







