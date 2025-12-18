/**
 * Portfolio Module
 * Exports portfolio risk management functionality
 */

export {
  // Classes
  PortfolioRiskManager,

  // Risk budget presets
  DEFAULT_RISK_BUDGET,
  AGGRESSIVE_RISK_BUDGET,
  CONSERVATIVE_RISK_BUDGET,

  // Helper functions
  calculateKellySize,
  calculateRiskAdjustedSize,
} from './risk-manager';

// Types
export type {
  RiskBudget,
  CurrentExposure,
  PositionSizeResult,
  TradeRiskAnalysis,
} from './risk-manager';







