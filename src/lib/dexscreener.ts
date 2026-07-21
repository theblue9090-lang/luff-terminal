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
      marketCapSol: undefined,
    }
  } catch {
    return null
  }
}

type NewTokenHandler = (t: TokenEvent) => void

export class DexScreenerPoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private abort: AbortController | null = null
  private seen = new Set<string>()
  private handler: NewTokenHandler
  private intervalMs: number
  private started = false

  constructor(handler: NewTokenHandler, intervalMs = 4000) {
    this.handler = handler
    this.intervalMs = intervalMs
  }

  start() {
    if (this.started) return
    this.started = true
    this.abort = new AbortController()
    // Prime `seen` on the first pass so we don't dump the whole backlog as
    // "new"; only genuinely fresh entries after startup are emitted.
    void this.poll(true)
    this.timer = setInterval(() => void this.poll(false), this.intervalMs)
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

  private async poll(prime: boolean) {
    const signal = this.abort?.signal
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
        if (prime) continue
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
      // Bound memory over long sessions.
      if (this.seen.size > 5000) {
        this.seen = new Set([...this.seen].slice(-2500))
      }
    } catch {
      // Transient network / rate-limit errors: swallow and retry next tick.
    }
  }
}
