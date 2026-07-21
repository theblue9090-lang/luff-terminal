// Small formatting / math helpers shared across the UI.

export function shortAddr(addr?: string, lead = 4, tail = 4): string {
  if (!addr) return '—'
  if (addr.length <= lead + tail + 1) return addr
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`
}

export function fmtSol(n?: number, digits = 4): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs < 0.0001) return n.toExponential(2)
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

export function fmtUsd(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function fmtPct(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

/** SOL amount with an explicit +/- sign, for PnL display. */
export function fmtSolSigned(n?: number, digits = 4): string {
  if (n == null || Number.isNaN(n)) return '—'
  const sign = n >= 0 ? '+' : '-'
  return `${sign}${fmtSol(Math.abs(n), digits)}`
}

/** USD amount with a +/- sign and 2 decimals, for PnL display. */
export function fmtUsdSigned(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  const sign = n >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Plain 2-decimal number (no currency symbol), signed only when negative. */
export function fmtNum2(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0')
}

export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

/**
 * Bonding-curve spot price in SOL per token, derived from virtual reserves.
 * Returns undefined if reserves are missing or degenerate.
 */
export function curvePrice(
  vSol?: number,
  vTokens?: number,
): number | undefined {
  if (!vSol || !vTokens || vTokens <= 0) return undefined
  return vSol / vTokens
}
