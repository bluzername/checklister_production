/**
 * Trade Plan Module
 *
 * Exports veto system and exit calculator functionality.
 */

// Veto System
export {
  evaluateVeto,
  evaluateVetoBatch,
  loadVetoModel,
  predictWinProbability,
  predictLossProbability,
  formatVetoResult,
  DEFAULT_VETO_CONFIG,
  type VetoConfig,
  type VetoResult,
  type ModelFile,
  type BatchVetoResult,
} from './veto-system';

// Exit Calculator
export {
  calculateExitLevels,
  calculateExitLevelsFromData,
  calculatePositionSize,
  calculateATR,
  calculateATRPercent,
  formatTradePlan,
  formatTradePlanCompact,
  DEFAULT_EXIT_CONFIG,
  type TradePlan,
  type PositionSize,
  type ExitConfig,
  type OHLCBar,
} from './exit-calculator';
