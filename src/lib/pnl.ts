// Pure PnL math shared by the dashboard and positions panel.

import type { Position } from '../types'

export interface PositionPnl {
  /** Percent gain/loss. */
  pnlPct?: number
  /** Absolute SOL gain/loss (unrealized for open, realized for closed). */
  pnlSol?: number
  /** Current value in SOL (open) or settled proceeds (closed). */
  valueSol?: number
  /** True when derived from a completed sell. */
  realized: boolean
}

/** Compute a single position's PnL. */
export function positionPnl(p: Position): PositionPnl {
  // Realized: a closed position with settled proceeds.
  if (p.status === 'closed' && p.exitProceedsSol != null) {
    const pnlSol = p.exitProceedsSol - p.investedSol
    const pnlPct = p.investedSol > 0 ? (pnlSol / p.investedSol) * 100 : undefined
    return { pnlPct, pnlSol, valueSol: p.exitProceedsSol, realized: true }
  }
  // Unrealized: entry + latest price known.
  if (
    p.entryPriceSol != null &&
    p.lastPriceSol != null &&
    p.entryPriceSol > 0
  ) {
    const pnlPct = ((p.lastPriceSol - p.entryPriceSol) / p.entryPriceSol) * 100
    const pnlSol = p.investedSol * (pnlPct / 100)
    return { pnlPct, pnlSol, valueSol: p.investedSol + pnlSol, realized: false }
  }
  return { realized: p.status === 'closed' }
}

export interface Aggregate {
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
  investedOpen: number
  valueOpen: number
  openCount: number
  closedCount: number
  failedCount: number
  wins: number
  losses: number
  winRate?: number
  best?: number
  worst?: number
}

const OPEN_LIKE = new Set(['open', 'buying', 'selling'])

/** Aggregate PnL across all positions. */
export function aggregate(positions: Position[]): Aggregate {
  let realizedPnl = 0
  let unrealizedPnl = 0
  let investedOpen = 0
  let valueOpen = 0
  let openCount = 0
  let closedCount = 0
  let failedCount = 0
  let wins = 0
  let losses = 0
  let best: number | undefined
  let worst: number | undefined

  for (const p of positions) {
    if (p.status === 'failed') {
      failedCount++
      continue
    }
    const pnl = positionPnl(p)
    if (pnl.pnlPct != null) {
      best = best == null ? pnl.pnlPct : Math.max(best, pnl.pnlPct)
      worst = worst == null ? pnl.pnlPct : Math.min(worst, pnl.pnlPct)
    }
    if (p.status === 'closed') {
      closedCount++
      if (pnl.pnlSol != null) {
        realizedPnl += pnl.pnlSol
        if (pnl.pnlSol > 0) wins++
        else losses++
      }
    } else if (OPEN_LIKE.has(p.status)) {
      openCount++
      investedOpen += p.investedSol
      valueOpen += pnl.valueSol ?? p.investedSol
      unrealizedPnl += pnl.pnlSol ?? 0
    }
  }

  const decided = wins + losses
  return {
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    investedOpen,
    valueOpen,
    openCount,
    closedCount,
    failedCount,
    wins,
    losses,
    winRate: decided > 0 ? (wins / decided) * 100 : undefined,
    best,
    worst,
  }
}
