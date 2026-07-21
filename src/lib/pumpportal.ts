// -----------------------------------------------------------------------------
// PumpPortal real-time data client.
//
// A single, long-lived WebSocket. PumpPortal explicitly asks clients to open
// ONE connection and multiplex subscriptions over it, so this module owns that
// connection and exposes subscribe/unsubscribe helpers plus callbacks.
//
// This is the fastest new-token signal available for pump.fun: token-creation
// events are pushed the instant the create transaction lands, with no polling
// latency. That speed is the whole point of the sniper.
// -----------------------------------------------------------------------------

import { PUMPPORTAL_WS } from '../config'
import type { FeedStatus, Pool, TokenEvent } from '../types'
import { curvePrice } from './format'

/** Raw PumpPortal message shape (subset we consume). */
interface PPMessage {
  txType?: 'create' | 'buy' | 'sell'
  mint?: string
  signature?: string
  traderPublicKey?: string
  name?: string
  symbol?: string
  uri?: string
  pool?: string
  solAmount?: number
  initialBuy?: number
  tokenAmount?: number
  newTokenBalance?: number
  marketCapSol?: number
  vTokensInBondingCurve?: number
  vSolInBondingCurve?: number
  bondingCurveKey?: string
  message?: string
}

/** A live trade for a subscribed mint (used for real-time price on positions). */
export interface TradeUpdate {
  mint: string
  txType: 'buy' | 'sell'
  priceSol?: number
  marketCapSol?: number
  vSolInBondingCurve?: number
  vTokensInBondingCurve?: number
  pool: Pool
  ts: number
}

type NewTokenHandler = (t: TokenEvent) => void
type TradeHandler = (t: TradeUpdate) => void
type StatusHandler = (s: FeedStatus) => void

function normPool(p?: string): Pool {
  switch (p) {
    case 'pump':
    case 'pump-amm':
    case 'raydium':
    case 'raydium-cpmm':
    case 'launchlab':
    case 'bonk':
      return p
    default:
      return 'pump'
  }
}

export class PumpPortalClient {
  private ws: WebSocket | null = null
  private status: FeedStatus = 'disconnected'
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false

  private newTokenHandlers = new Set<NewTokenHandler>()
  private tradeHandlers = new Set<TradeHandler>()
  private statusHandlers = new Set<StatusHandler>()

  /** Whether we've asked for the new-token firehose. */
  private wantNewTokens = false
  /**
   * Reference-counted per-mint trade subscriptions. A mint can back more than
   * one open position, so we only unsubscribe when the last watcher leaves —
   * otherwise closing one position would blind the others' TP/SL.
   */
  private tradeWatchers = new Map<string, number>()

  connect() {
    this.closedByUser = false
    this.open()
  }

  private open() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    this.setStatus('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(PUMPPORTAL_WS)
    } catch {
      this.setStatus('error')
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.setStatus('connected')
      // Only reset backoff once the connection has proven stable for a while;
      // resetting immediately would defeat exponential backoff when the socket
      // opens then drops in a tight flap loop.
      if (this.stableTimer) clearTimeout(this.stableTimer)
      this.stableTimer = setTimeout(() => {
        this.reconnectAttempts = 0
      }, 10000)
      // Re-apply any subscriptions after a (re)connect.
      if (this.wantNewTokens) this.send({ method: 'subscribeNewToken' })
      const mints = [...this.tradeWatchers.keys()]
      if (mints.length > 0) {
        this.send({ method: 'subscribeTokenTrade', keys: mints })
      }
    }

    ws.onmessage = (ev) => this.handleMessage(ev.data)

    ws.onerror = () => {
      // onclose will follow and drive reconnection.
      this.setStatus('error')
    }

    ws.onclose = () => {
      this.ws = null
      if (this.stableTimer) {
        clearTimeout(this.stableTimer)
        this.stableTimer = null
      }
      if (this.closedByUser) {
        this.setStatus('disconnected')
        return
      }
      this.setStatus('disconnected')
      this.scheduleReconnect()
    }
  }

  private handleMessage(data: unknown) {
    if (typeof data !== 'string') return
    let msg: PPMessage
    try {
      msg = JSON.parse(data) as PPMessage
    } catch {
      return
    }
    // Server ack / errors arrive as `{ message: "..." }` with no txType.
    if (!msg.txType) return

    if (msg.txType === 'create') {
      if (!msg.mint) return
      const price = curvePrice(
        msg.vSolInBondingCurve,
        msg.vTokensInBondingCurve,
      )
      const token: TokenEvent = {
        mint: msg.mint,
        name: msg.name,
        symbol: msg.symbol,
        source: 'pumpfun',
        pool: normPool(msg.pool),
        detectedAt: Date.now(),
        creator: msg.traderPublicKey,
        devBuySol: msg.solAmount,
        priceSol: price,
        marketCapSol: msg.marketCapSol,
        vSolInBondingCurve: msg.vSolInBondingCurve,
        vTokensInBondingCurve: msg.vTokensInBondingCurve,
        uri: msg.uri,
      }
      for (const h of this.newTokenHandlers) h(token)
      return
    }

    // buy / sell trade update for a subscribed mint.
    if (!msg.mint) return
    const price =
      curvePrice(msg.vSolInBondingCurve, msg.vTokensInBondingCurve) ??
      (msg.tokenAmount && msg.tokenAmount > 0 && msg.solAmount != null
        ? msg.solAmount / msg.tokenAmount
        : undefined)
    const update: TradeUpdate = {
      mint: msg.mint,
      txType: msg.txType,
      priceSol: price,
      marketCapSol: msg.marketCapSol,
      vSolInBondingCurve: msg.vSolInBondingCurve,
      vTokensInBondingCurve: msg.vTokensInBondingCurve,
      pool: normPool(msg.pool),
      ts: Date.now(),
    }
    for (const h of this.tradeHandlers) h(update)
  }

  private send(payload: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  private scheduleReconnect() {
    if (this.closedByUser) return
    if (this.reconnectTimer) return
    // Exponential backoff, capped, so we recover fast but don't hammer.
    const delay = Math.min(15000, 1000 * 2 ** this.reconnectAttempts)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  private setStatus(s: FeedStatus) {
    if (this.status === s) return
    this.status = s
    for (const h of this.statusHandlers) h(s)
  }

  getStatus(): FeedStatus {
    return this.status
  }

  // --- public subscription API ------------------------------------------------

  subscribeNewTokens() {
    this.wantNewTokens = true
    this.send({ method: 'subscribeNewToken' })
  }

  unsubscribeNewTokens() {
    this.wantNewTokens = false
    this.send({ method: 'unsubscribeNewToken' })
  }

  watchTrades(mint: string) {
    const n = this.tradeWatchers.get(mint) ?? 0
    this.tradeWatchers.set(mint, n + 1)
    // Subscribe only on the first watcher for this mint.
    if (n === 0) this.send({ method: 'subscribeTokenTrade', keys: [mint] })
  }

  unwatchTrades(mint: string) {
    const n = this.tradeWatchers.get(mint) ?? 0
    if (n === 0) return
    if (n === 1) {
      this.tradeWatchers.delete(mint)
      // Unsubscribe only when the last watcher leaves.
      this.send({ method: 'unsubscribeTokenTrade', keys: [mint] })
    } else {
      this.tradeWatchers.set(mint, n - 1)
    }
  }

  onNewToken(h: NewTokenHandler): () => void {
    this.newTokenHandlers.add(h)
    return () => this.newTokenHandlers.delete(h)
  }

  onTrade(h: TradeHandler): () => void {
    this.tradeHandlers.add(h)
    return () => this.tradeHandlers.delete(h)
  }

  onStatus(h: StatusHandler): () => void {
    this.statusHandlers.add(h)
    return () => this.statusHandlers.delete(h)
  }

  disconnect() {
    this.closedByUser = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.setStatus('disconnected')
  }
}

/** Process-wide singleton — one socket per tab, as PumpPortal requires. */
export const pumpPortal = new PumpPortalClient()
