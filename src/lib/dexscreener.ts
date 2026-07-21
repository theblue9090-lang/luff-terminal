// -----------------------------------------------------------------------------
// DexScreener client.
//
// Two jobs:
//   1) Poll the "latest token profiles" feed for freshly listed Solana tokens
//      (the closest thing the public API has to a new-token firehose).
//   2) Enrich any mint with live price / liquidity / age via /latest/dex/tokens.
//
// Rate limits: token-profiles ~60 req/min, dex/tokens ~300 req/min. The default
// 4s poll interval stays comfortably inside both.
// -----------------------------------------------------------------------------

import { DEXSCREENER_BASE, SOL_MINT } from '../config'
import type { Pool, TokenEvent } from '../types'

interface DsProfile {
  chainId: string
  tokenAddress: string
  icon?: string
  description?: string
  url?: string
}

interface DsToken {
  address: string
  name?: string
  symbol?: string
}

interface DsLiquidity {
  usd?: number
  base?: number
  quote?: number
}

interface DsPair {
  chainId: string
  dexId?: string
  pairAddress: string
  baseToken: DsToken
  quoteToken: DsToken
  priceNative?: string
  priceUsd?: string
  liquidity?: DsLiquidity
  fdv?: number
  marketCap?: number
  pairCreatedAt?: number
}

function dexToPool(dexId?: string): Pool {
  switch (dexId) {
    case 'raydium':
      return 'raydium'
    case 'pumpfun':
    case 'pump':
      return 'pump'
    case 'pumpswap':
      return 'pump-amm'
    case 'launchlab':
      return 'launchlab'
    default:
      return 'auto'
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`DexScreener ${res.status}`)
  return (await res.json()) as T
}

/** Fetch enrichment (best pair) for a single mint. */
export async function enrichMint(
  mint: string,
  signal?: AbortSignal,
): Promise<Partial<TokenEvent> | null> {
  try {
    const data = await getJson<{ pairs?: DsPair[] } | DsPair[]>(
      `${DEXSCREENER_BASE}/latest/dex/tokens/${mint}`,
      signal,
    )
    const pairs = Array.isArray(data) ? data : (data.pairs ?? [])
    const solPairs = pairs.filter((p) => p.chainId === 'solana')
    if (solPairs.length === 0) return null
    // Deepest liquidity pair is the most representative.
    const best = solPairs.reduce((a, b) =>
      (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a,
    )
    const quoteIsSol = best.quoteToken.address === SOL_MINT
    const priceSol =
      quoteIsSol && best.priceNative
        ? Number(best.priceNative)
        : undefined
    return {
      name: best.baseToken.name,
      symbol: best.baseToken.symbol,
      pool: dexToPool(best.dexId),
      priceSol: Number.isFinite(priceSol) ? priceSol : undefined,
      liquidityUsd: best.liquidity?.usd,
      pairCreatedAt: best.pairCreatedAt,
      marketCapSol: undefined,
    }
  } catch {
    return null
  }
}

/**
 * Batch-fetch current SOL prices for many mints in one request. This is the
 * key-free way to keep held-position PnL live: PumpPortal's per-token trade
 * stream requires a paid API key, but DexScreener indexes pump.fun tokens
 * (bonding-curve and migrated) and its price is free to poll.
 */
export async function fetchPricesSol(
  mints: string[],
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (mints.length === 0) return out
  try {
    // /latest/dex/tokens accepts up to 30 comma-separated addresses.
    const data = await getJson<{ pairs?: DsPair[] } | DsPair[]>(
      `${DEXSCREENER_BASE}/latest/dex/tokens/${mints.slice(0, 30).join(',')}`,
      signal,
    )
    const pairs = Array.isArray(data) ? data : (data.pairs ?? [])
    // Keep the deepest-liquidity solana pair per base mint.
    const best = new Map<string, DsPair>()
    for (const p of pairs) {
      if (p.chainId !== 'solana') continue
      const mint = p.baseToken.address
      const prev = best.get(mint)
      if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) {
        best.set(mint, p)
      }
    }
    for (const [mint, p] of best) {
      const quoteIsSol = p.quoteToken.address === SOL_MINT
      const price =
        quoteIsSol && p.priceNative ? Number(p.priceNative) : undefined
      if (price != null && Number.isFinite(price) && price > 0) {
        out.set(mint, price)
      }
    }
  } catch {
    /* transient — caller retries next tick */
  }
  return out
}

type NewTokenHandler = (t: TokenEvent) => void

export class DexScreenerPoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private abort: AbortController | null = null
  private seen = new Set<string>()
  private handler: NewTokenHandler
  private intervalMs: number
  private started = false
  /**
   * Set true only after the FIRST fully successful fetch has populated `seen`.
   * Until then every pass is a priming pass that records but emits nothing, so
   * a slow or failed prime can never dump the whole backlog as "new".
   */
  private primed = false

  constructor(handler: NewTokenHandler, intervalMs = 4000) {
    this.handler = handler
    this.intervalMs = intervalMs
  }

  start() {
    if (this.started) return
    this.started = true
    this.primed = false
    this.abort = new AbortController()
    void this.poll()
    this.timer = setInterval(() => void this.poll(), this.intervalMs)
  }

  stop() {
    this.started = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.abort) {
      this.abort.abort()
      this.abort = null
    }
  }

  private async poll() {
    const signal = this.abort?.signal
    // Capture prime state at pass start; we only emit once a prior pass fully
    // succeeded. `this.primed` is flipped true only after this pass completes.
    const wasPrimed = this.primed
    try {
      const profiles = await getJson<DsProfile[]>(
        `${DEXSCREENER_BASE}/token-profiles/latest/v1`,
        signal,
      )
      const solProfiles = (profiles ?? []).filter(
        (p) => p.chainId === 'solana',
      )
      for (const p of solProfiles) {
        if (this.seen.has(p.tokenAddress)) continue
        this.seen.add(p.tokenAddress)
        if (!wasPrimed) continue // priming pass: record, emit nothing
        // Emit immediately with what we have; enrichment fills in price/liq.
        const base: TokenEvent = {
          mint: p.tokenAddress,
          source: 'dexscreener',
          pool: 'auto',
          detectedAt: Date.now(),
          uri: p.icon,
        }
        const enriched = await enrichMint(p.tokenAddress, signal)
        this.handler(enriched ? { ...base, ...enriched } : base)
      }
      // Mark primed only after a fully successful pass.
      this.primed = true
      // Bound memory over long sessions.
      if (this.seen.size > 5000) {
        this.seen = new Set([...this.seen].slice(-2500))
      }
    } catch {
      // Transient network / rate-limit errors: swallow and retry next tick.
      // `primed` stays false if the very first pass failed, so we re-prime.
    }
  }
}
