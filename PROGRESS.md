# Checklister - Progress Report

**Last Updated**: January 10, 2026
**Current Phase**: Workstream F Complete, Ready for Workstream G

---

## Quick Start for New Claude Code Session

### 1. Read the Full Plan
```bash
cat /Users/xx/.claude/plans/delegated-finding-galaxy.md
```

### 2. Test the Main CLI Tool
```bash
# Evaluate a trade using cached data
npx tsx scripts/evaluate-trade.ts --ticker AAPL --cache

# Or with live Yahoo Finance data
npx tsx scripts/evaluate-trade.ts --ticker AAPL
```

### 3. Retrain Model (if needed)
```bash
# Generate training data from cache
npx ts-node scripts/generate-from-cache-v2.ts --target 50000 --output data/training-50k-v2.json --split train

# Train model
npx ts-node scripts/train-model-v2.ts
```

---

## System Overview

**Purpose**: Swing trading system with ML-based timing veto for user-provided "soft signals" (insider buying, politician trades).

**Core Design**:
```
[User Provides Ticker with "Soft Signal"]
    ↓
[System Evaluates Timing via ML]
    ↓
[P(loss) > 60%?] ──YES──→ [VETO: "Not a good time to buy"]
    │
    NO
    ↓
[Calculate Exit Levels: Stop Loss, TP1, TP2, TP3]
    ↓
[Return Trade Plan to User]
```

---

## Completed Workstreams

### Workstream A - Point-in-Time Safety ✅
- All 54 features are now PIT-safe
- `asOfDate` threaded through all feature builders
- Runtime enforcement in backtests

### Workstream B - Simulator/Label Alignment ✅
- Partial exits (33/33/34 TP tranches) implemented
- Cash accounting fixed
- Engine-based labeling matches simulator
- 27 regression tests passing

### Workstream C - Dataset Growth ✅
- 391 tickers × 7 years = 636K price records cached
- 50K training + 15K validation samples
- Offline generation in ~3 seconds

### Workstream D - Modeling ✅
- Key finding: **AUC = 0.52-0.53** (technical features have minimal predictive power)
- 40-feature v2 model trained
- Strategy has +EV via R/R structure (break-even 27.2%, actual 39.9%)

### Workstream F - Veto System ✅ (Jan 10, 2026)
- **F1**: Veto model using P(loss) threshold
- **F2**: Exit calculator with ATR-based stops
- **F3**: Veto evaluation framework (`scripts/evaluate-veto.ts`)
- **F4/F5**: Trade Plan CLI (`scripts/evaluate-trade.ts`)

---

## Current State

### Key Files

| File | Purpose |
|------|---------|
| `data/model-v2.json` | Production model (40 features, logistic regression) |
| `data/price-cache.sqlite` | 636K price records (129 MB) |
| `data/training-50k-v2.json` | Training dataset |
| `src/lib/trade-plan/` | Veto system + exit calculator |
| `scripts/evaluate-trade.ts` | Main CLI for trade evaluation |
| `scripts/evaluate-veto.ts` | Veto system metrics |

### Model Performance

| Metric | Value |
|--------|-------|
| Model Version | 2.0-improved-40features |
| Training Samples | 35,001 |
| Holdout AUC | 0.538 |
| Veto Threshold | P(loss) > 60% |
| Veto Precision | ~83% at optimal threshold |

### API Keys Configured

| Service | Status | Location |
|---------|--------|----------|
| FMP API | ✅ Configured | `.env.local` |
| Yahoo Finance | ✅ Working | Default fallback |
| Quiver Quantitative | ❌ Not yet | Needed for Workstream G |

---

## Next Steps: Workstream G (Quiver Integration)

**Goal**: Replace manual Telegram scraping with automated soft signal data ingestion.

**Prerequisites**:
- Quiver Quantitative API key ($10/mo Hobbyist tier)
- 7-day free trial available

**Phase G1 Tasks** (Weeks 1-2):
- [ ] G1.1: Create `src/lib/data-services/quiver.ts` - API client
- [ ] G1.2: Create `data/quiver-cache.sqlite` - Local cache
- [ ] G1.3: Create `scripts/warm-quiver-cache.ts` - Hydrate history
- [ ] G1.4: Add soft signal features to model

**New Features to Add**:
- `hasInsiderBuyL30` - Insider purchase in last 30 days
- `hasInsiderBuyL90` - Insider purchase in last 90 days
- `insiderBuyCount30` - Count of insider buys
- `hasCongressBuy` - Congress member bought
- `insiderCluster` - 3+ insiders bought (clustering signal)

---

## Session Log

| Date | Session | Completed |
|------|---------|-----------|
| 2025-12-15 | 1 | Workstream A (PIT safety) |
| 2025-12-15 | 2 | Workstream B (Simulator alignment) |
| 2025-12-15 | 3 | Workstream C (Dataset growth) |
| 2025-12-15 | 4 | Workstream D (Modeling) |
| 2025-12-16 | 5-6 | D.5-D.6 (Model analysis, v2 features) |
| 2026-01-10 | 7 | Model retrain, soft signal validation |
| 2026-01-10 | 8 | Workstream F complete (Veto CLI) |

---

## Important Context for New Sessions

1. **The ML model has weak predictive power** (AUC ~0.53). This is expected - technical patterns don't predict outcomes in efficient markets.

2. **The edge comes from soft signals** (insider buying, politician trades), not ML. ML's job is timing filter only.

3. **Veto system design**: High threshold (P(loss) > 60%) means we only veto when confident it's bad timing.

4. **Exit structure**: 1.5 ATR stop, TP1 at 2R, TP2 at 3R, TP3 at 4R with 33/33/34 partial exits.

5. **FMP API is available** for higher-quality price data (key in `.env.local`).

---

## Useful Commands

```bash
# Evaluate a trade
npx tsx scripts/evaluate-trade.ts --ticker NVDA --signal insider_buy --cache

# Evaluate veto system performance
npx ts-node scripts/evaluate-veto.ts --model data/model-v2.json

# Warm price cache for new tickers
npx ts-node scripts/warm-price-cache.ts --tickers MSFT,GOOGL,META

# Generate training data
npx ts-node scripts/generate-from-cache-v2.ts --target 50000 --output data/training-50k-v2.json --split train

# Train model
npx ts-node scripts/train-model-v2.ts

# Run simulator regression tests
npx ts-node scripts/test-simulator-regression.ts
```
