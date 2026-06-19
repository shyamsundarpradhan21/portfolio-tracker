# Dhan US Sleeve — Finalized Plan

**Status:** FINAL · locked 2026-06-19 · first SIP July 2026
**Context:** New US money → Dhan (GIFT City/Raise IFSC). Existing Vested/DriveWealth
holdings & Vests are KEPT, not exited. Monthly SIP ~$300–600, fractional shares.
**Posture:** aggressive growth, "double down"; built bottom-up from all 24 Vested
Vests (risk-adjusted weighting) with a June-2026 macro overlay.

## Macro thesis (June 2026)
Hawkish Fed (3.50–3.75%, dot plot implies a hike, no cuts) + sticky core PCE 3.3%
+ strong dollar (DXY ~101) → punish long-duration growth/REITs/EM, reward quality
& hard assets. AI capex super-cycle intact (~$725B hyperscaler, +77% YoY) but the
bottleneck moved from chips → **power**. Gold +24% YTD (CB buying), copper +32% YoY.
Leadership: AI-infra, power/electrification, commodities, defense.

## Sector allocation
| Sector | Wt |
|---|---:|
| AI compute & semis | 22% |
| AI power & electrification | 19% |
| AI/Big-Tech beta (QQQM) | 12% |
| Gold + commodities | 13% |
| Quality-dividend (SCHD) | 8% |
| US broad (VOO) | 7% |
| Defense | 4% |
| Copper | 3% |
| EM (underweight — strong $) | 3% |
| Bonds (min duration) | 3% |
| Big-tech value / crypto-financial | 6% |

Mix: **46% ETF / 54% direct** · ~66% growth-AI-correlated / ~34% ballast · 21 holdings.

## Holdings (target weights · $ at a $500 SIP · scale $/1% × SIP/100)
| Ticker | Wt | $@500 | Type | Thesis |
|---|---:|---:|---|---|
| QQQM | 12% | $60 | ETF | AI/big-tech beta core (your anchor) |
| GLDM | 8% | $40 | ETF | gold — inflation / de-dollarization |
| SCHD | 8% | $40 | ETF | quality-dividend, holds up higher-for-longer (your anchor) |
| VOO | 7% | $35 | ETF | US broad core |
| PDBC | 5% | $25 | ETF | commodities — inflation |
| EEM | 3% | $15 | ETF | EM — underweight (strong dollar) |
| IUSB | 3% | $15 | ETF | short-duration bond ballast |
| MU | 5% | $25 | Stock | HBM/DRAM super-cycle, ~74% GM, 11× fwd P/E |
| NVDA | 5% | $25 | Stock | GPU monopoly, DC rev +92% YoY, Rubin Q3 |
| TSM | 5% | $25 | Stock (ADR) | foundry chokepoint, 2nm booked |
| AVGO | 4% | $20 | Stock | custom AI silicon + networking |
| ASML | 3% | $15 | Stock (ADR) | EUV monopoly — semis pick-and-shovel |
| GEV | 5% | $25 | Stock | GE Vernova — turbines sold out to 2030, $163B backlog |
| VST | 4% | $20 | Stock | IPP, nuclear PPAs to AWS/Meta |
| IREN | 4% | $20 | Stock | miner pivoting power+shells to AI/HPC hosting |
| CCJ | 3% | $15 | Stock | uranium — structural deficit, restarts+SMRs |
| NXT | 3% | $15 | Stock | Nextracker — solar/grid; top vest conviction |
| LHX | 4% | $20 | Stock | defense prime — rearmament backlog |
| FCX | 3% | $15 | Stock | copper — metal of electrification |
| GOOGL | 3% | $15 | Stock | cheapest mega-cap (AI+cloud+ads) |
| COIN | 3% | $15 | Stock | crypto-financial; sized down (hawkish-Fed headwind) |

## Rebalancing policy
- **Monthly:** new-money steering only — direct the SIP to the most-underweight
  sleeves. Primary tool; no selling. Free.
- **Quarterly:** 5-min drift check; trade only if a band is breached AND the lot
  is >24 months old.
- **Annual:** full rebalance + thesis/macro refresh (re-run the vest numbers +
  macro; targets change more than drift does).
- **Sell trigger:** band of ±5% absolute / ±25% relative — NOT the calendar.
  Crypto/miners drift fastest → watched tightest.
- **Tax gate:** don't sell positions <24 months (STCG at slab); after 24 months
  trims are 12.5% LTCG. Let new money correct under-24mo drift.

## Dhan charges (verified June 2026)
Brokerage 0.25% of trade value (min $0.01/order) · deposit $1 only if a transfer
<$100 (fund ≥$100) · withdrawals free · no AMC/custody/platform/SIP fees · FX
INR→USD is bank-side under LRS (markup shown before each transfer — pick a bank
with a tight spread) · TCS zero below ₹10L/yr LRS.

## Risks (owned, not hidden)
1. ~66% growth/AI-correlated — if AI capex rolls over in 2027 the top half
   de-rates together; the gold/commodity/SCHD/bond sleeve (~22%) is the offset.
2. IREN and the miners carry execution risk on the AI-hosting pivot.
3. Data is web-sourced (stockanalysis.com + macro research, Jun 2026); forward
   EPS/estimates are the softest inputs — no institutional feed connected.

## Provenance
Vest catalog scraped to `data/vested_vests.json`; portfolio built from all 24
vests (risk-adjusted) + `comps-analysis` screen of 48 names + June-2026 macro
research. Deferred next step: wire the tracker for a 2nd US broker
(`app/portfolio.js` has no broker dimension today).
