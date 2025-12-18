/**
 * Universe Module
 * Exports universe filter types and functions
 */

export {
  // Default filters
  DEFAULT_UNIVERSE_FILTER,
  CONSERVATIVE_UNIVERSE_FILTER,
  GROWTH_UNIVERSE_FILTER,
  SP500_FILTER,
  
  // Stock lists
  SP500_TICKERS,
  NDX100_TICKERS,
  HIGH_BETA_TECH,
  
  // Filter functions
  passesFilter,
  filterTickers,
  
  // Universe definition management
  saveUniverseDefinition,
  getUniverseDefinition,
  listUniverseDefinitions,
  refreshUniverseTickers,
  
  // Quick getters
  getUniverseTickers,
  getQuickUniverse,
} from './filter';







