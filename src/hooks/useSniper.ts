// -----------------------------------------------------------------------------
// useSniper — the engine.
//
// Wires the two detection feeds (PumpPortal WS + DexScreener poll) to the store,
// runs auto-snipe evaluation on qualifying new tokens, streams live prices for
// held mints, and enforces take-profit / stop-loss. All trades are signed by the
// Privy embedded wallet WITHOUT a confirmation modal (showWalletUIs:false) and
// broadcast through one warm RPC connection.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from 'react'
import { PublicKey } from '@solana/web3.js'
import { useSolanaWallets, useSignTransaction } from '@privy-io/react-auth/solana'
import {
  BLOCKED_MINTS,
  DEX_MAX_AGE_MIN,
  FEE_BUFFER_SOL,
  PUMPPORTAL_HAS_KEY,
  SNIPEABLE_POOLS,
  type SnipeConfig,
} from '../config'
import type { Position, TokenEvent } from '../types'
import { useStore } from '../state/store'
import { pumpPortal, type TradeUpdate } from '../lib/pumpportal'
import {
  DexScreenerPoller,
  fetchPricesSol,
  fetchSolPriceUsd,
} from '../lib/dexscreener'
import { fetchBondingCurvePrices } from '../lib/pumpfun'
import { primaryConnection, readPoolSize } from '../lib/rpc'
import { confirmSignature, executeTrade, type SignFn } from '../lib/trade'
import { fmtSol, shortAddr } from '../lib/format'

/** How often held-position prices are refreshed (ms). */
const PRICE_POLL_MS = 2000

/** Position states that are live and need price/PnL tracking. */
const LIVE_STATES = new Set(['open', 'buying', 'selling'])

/**
 * Fill in USD market cap / liquidity. DexScreener tokens already carry USD;
 * pump.fun tokens report SOL, so convert with the live SOL price.
 */
function withUsd(t: TokenEvent, solUsd: number | null): TokenEvent {
  const marketCapUsd =
    t.marketCapUsd ??
    (t.marketCapSol != null && solUsd ? t.marketCapSol * solUsd : undefined)
  const liquidityUsd =
    t.liquidityUsd ??
    (t.vSolInBondingCurve != null && solUsd
      ? t.vSolInBondingCurve * solUsd
      : undefined)
  return { ...t, marketCapUsd, liquidityUsd }
}

/** Detection gate: only surface tokens within the configured USD mcap/liq. */
function passesDetection(t: TokenEvent, cfg: SnipeConfig): boolean {
  if (
    cfg.minMarketCapUsd > 0 &&
    t.marketCapUsd != null &&
    t.marketCapUsd < cfg.minMarketCapUsd
  ) {
    return false
  }
  if (
    cfg.maxMarketCapUsd > 0 &&
    t.marketCapUsd != null &&
    t.marketCapUsd > cfg.maxMarketCapUsd
  ) {
    return false
  }
  if (
    cfg.minLiquidityUsd > 0 &&
    t.liquidityUsd != null &&
    t.liquidityUsd < cfg.minLiquidityUsd
  ) {
    return false
  }
  return true
}

/**
 * DexScreener token-profiles is a promotions feed, not a new-launch feed, so
 * only auto-snipe entries that enrichment confirms are on a snipeable pool AND
 * genuinely fresh — this avoids `trade-local 400` on established tokens.
 */
function isDexSnipeable(t: TokenEvent): boolean {
  if (!SNIPEABLE_POOLS.has(t.pool)) return false
  if (t.pairCreatedAt == null) return false
  return Date.now() - t.pairCreatedAt < DEX_MAX_AGE_MIN * 60_000
}

/** Turn a raw trade error into an actionable one-liner. */
function errorHint(msg: string): string {
  if (/all RPCs rejected|403|forbidden|429|rate/i.test(msg)) {
    return ' — every free RPC refused/limited the send. For reliable broadcasting set VITE_SOLANA_RPC to a paid RPC (Helius / QuickNode / Triton).'
  }
  if (/trade-local 400|bad request/i.test(msg)) {
    return ' — token not snipeable on this pool (already migrated, or not a pump/raydium token).'
  }
  if (/timed out|timeout/i.test(msg)) {
    return ' — request timed out; the free RPC may be busy.'
  }
  return ''
}

export interface SniperApi {
  ready: boolean
  address?: string
  start: () => void
  stop: () => void
  manualBuy: (mint: string, amountSol?: number) => void
  sellPosition: (id: string, reason?: string) => void
  closeAll: () => void
  refreshBalance: () => void
}

export function useSniper(): SniperApi {
  const { wallets } = useSolanaWallets()
  const { signTransaction } = useSignTransaction()

  // Pin the trading wallet to the Privy EMBEDDED wallet — the one
  // useSignTransaction actually signs with. Never blindly take wallets[0],
  // which can be an external wallet (Phantom) whose signer != fee payer.
  const wallet =
    wallets.find(
      (w) =>
        w.walletClientType === 'privy' || w.walletClientType === 'privy-v2',
    ) ?? wallets[0]
  const address = wallet?.address

  // Primary connection from the pooled RPC list (used for signing context,
  // confirmation, and balance). Price reads round-robin across the whole pool.
  const connection = primaryConnection

  // Keep the latest signer / address in refs so hot-path callbacks stay stable.
  const signRef = useRef(signTransaction)
  signRef.current = signTransaction
  const addrRef = useRef<string | undefined>(address)
  addrRef.current = address

  // A signer that never shows a wallet modal — this is what makes auto-snipe
  // fire without a per-trade confirmation. Also pins the signing address to the
  // embedded wallet so signer and fee payer always match.
  const sign = useCallback<SignFn>(
    (args) =>
      signRef.current({
        transaction: args.transaction,
        connection: args.connection,
        uiOptions: { showWalletUIs: false },
        address: addrRef.current,
      }),
    [],
  )

  // Guards against duplicate concurrent trades keyed by mint (buys) / posId (sells).
  const inFlight = useRef(new Set<string>())
  // mint -> set of live position ids, so one trade update reaches every position
  // held in that mint (a mint can back more than one position).
  const posByMint = useRef(new Map<string, Set<string>>())
  const dexPoller = useRef<DexScreenerPoller | null>(null)
  // Latest price-poll fn, so a buy can trigger an immediate refresh.
  const pollRef = useRef<() => void>(() => {})
  // Throttle "skipped (below filter)" console lines so the feed doesn't flood.
  const lastSkipLog = useRef(0)

  const addMapping = (mint: string, posId: string) => {
    let set = posByMint.current.get(mint)
    if (!set) {
      set = new Set()
      posByMint.current.set(mint, set)
    }
    set.add(posId)
  }
  const removeMapping = (mint: string, posId: string) => {
    const set = posByMint.current.get(mint)
    if (!set) return
    set.delete(posId)
    if (set.size === 0) posByMint.current.delete(mint)
  }

  const refreshBalance = useCallback(() => {
    const addr = addrRef.current
    if (!addr) return
    connection
      .getBalance(new PublicKey(addr), 'confirmed')
      .then((lamports) => useStore.getState().setBalance(lamports / 1e9))
      .catch(() => {
        /* transient */
      })
  }, [connection])

  const sellPosition = useCallback(
    async (posId: string, reason = 'manual') => {
      const g = useStore.getState()
      const pos = g.positions.find((p) => p.id === posId)
      if (!pos) return
      // Only sell CONFIRMED holdings. A 'buying' position may not own tokens yet.
      if (pos.status !== 'open') return
      const addr = addrRef.current
      if (!addr) {
        g.log('error', 'cannot sell: no wallet')
        return
      }
      const key = 'sell:' + posId
      if (inFlight.current.has(key)) return
      inFlight.current.add(key)

      const cfg = g.config
      const sym = pos.symbol || shortAddr(pos.mint)
      g.updatePosition(posId, { status: 'selling' })
      g.log('trade', `SELL ${sym} (${reason})`)
      try {
        const res = await executeTrade(
          {
            action: 'sell',
            mint: pos.mint,
            publicKey: addr,
            amount: '100%',
            denominatedInSol: false,
            slippage: cfg.slippage,
            priorityFee: cfg.priorityFee,
            pool: pos.pool,
          },
          sign,
          connection,
        )
        const proceeds =
          pos.tokenAmount != null && pos.lastPriceSol != null
            ? pos.tokenAmount * pos.lastPriceSol
            : undefined
        useStore.getState().updatePosition(posId, { sellSignature: res.signature })
        useStore
          .getState()
          .log(
            'success',
            `SELL sent ${shortAddr(res.signature)} in ${res.elapsedMs.toFixed(0)}ms`,
          )
        confirmSignature(connection, res.signature)
          .then((result) => {
            const s = useStore.getState()
            if (result === 'confirmed') {
              s.updatePosition(posId, {
                status: 'closed',
                closedAt: Date.now(),
                exitProceedsSol: proceeds,
              })
              s.log('success', `SELL confirmed ${sym}`)
              removeMapping(pos.mint, posId)
              pumpPortal.unwatchTrades(pos.mint)
              refreshBalance()
            } else if (result === 'failed') {
              // Proven dropped/reverted — reopen so it can be retried.
              s.updatePosition(posId, { status: 'open', error: 'sell reverted' })
              s.log('warn', `SELL reverted, position reopened ${sym}`)
            } else {
              // timeout — keep 'selling' so onTrade can't re-fire; tx may land.
              s.log('warn', `SELL unconfirmed (kept selling) ${sym}`)
            }
          })
          .finally(() => inFlight.current.delete(key))
      } catch (e) {
        const msg = (e as Error).message
        useStore.getState().updatePosition(posId, { status: 'open', error: msg })
        useStore.getState().log('error', `SELL error: ${msg}${errorHint(msg)}`)
        inFlight.current.delete(key)
      }
    },
    [connection, refreshBalance, sign],
  )

  const snipe = useCallback(
    async (token: TokenEvent, auto: boolean, amountOverride?: number) => {
      const g = useStore.getState()
      const cfg = g.config
      const addr = addrRef.current
      const sym = token.symbol || shortAddr(token.mint)
      if (!addr) {
        g.log('error', 'cannot buy: no wallet')
        return
      }
      if (inFlight.current.has(token.mint)) return

      if (auto) {
        const openLike = g.positions.filter(
          (p) => p.status === 'open' || p.status === 'buying',
        ).length
        if (openLike >= cfg.maxOpenPositions) return
        // Never auto-buy a mint we already have a live position in.
        if (
          g.positions.some(
            (p) =>
              p.mint === token.mint &&
              (p.status === 'open' || p.status === 'buying' || p.status === 'selling'),
          )
        ) {
          return
        }
      }

      const invested = amountOverride ?? cfg.buyAmountSol

      // --- safety guards (before any state mutation) --------------------------
      const needed = invested + cfg.priorityFee + FEE_BUFFER_SOL
      if (g.balanceSol != null && g.balanceSol < needed) {
        g.log(
          'warn',
          `skip ${sym}: balance ${fmtSol(g.balanceSol)}◎ < needed ${fmtSol(needed)}◎`,
        )
        return
      }
      if (cfg.maxSpendSol > 0 && g.sessionSpentSol + invested > cfg.maxSpendSol) {
        g.log(
          'warn',
          `skip ${sym}: session spend cap ${cfg.maxSpendSol}◎ reached`,
        )
        return
      }

      inFlight.current.add(token.mint)
      g.addSpend(invested) // reserve against the cap; refunded if the buy fails
      const posId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${token.mint}-${Date.now()}`
      const position: Position = {
        id: posId,
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        pool: token.pool,
        status: 'buying',
        investedSol: invested,
        // Leave entry undefined: the true entry is captured from the first real
        // trade after our buy (reflects slippage + our own price impact), which
        // onTrade backfills. The detection price is only a provisional display.
        entryPriceSol: undefined,
        lastPriceSol: token.priceSol,
        tokenAmount: undefined,
        openedAt: Date.now(),
        takeProfitPct: cfg.takeProfitPct,
        stopLossPct: cfg.stopLossPct,
      }
      g.addPosition(position)
      // Track + subscribe to price BEFORE the buy resolves so we never miss the
      // first post-buy trade that establishes our entry.
      addMapping(token.mint, posId)
      pumpPortal.watchTrades(token.mint)
      g.log(
        'trade',
        `BUY ${sym} ${invested} SOL [${token.pool}]${auto ? ' (auto)' : ''}`,
      )

      try {
        const res = await executeTrade(
          {
            action: 'buy',
            mint: token.mint,
            publicKey: addr,
            amount: invested,
            denominatedInSol: true,
            slippage: cfg.slippage,
            priorityFee: cfg.priorityFee,
            pool: token.pool,
          },
          sign,
          connection,
        )
        useStore.getState().updatePosition(posId, { buySignature: res.signature })
        useStore
          .getState()
          .log(
            'success',
            `BUY sent ${sym} ${shortAddr(res.signature)} in ${res.elapsedMs.toFixed(0)}ms`,
          )
        // Immediately read the price so PnL goes live within an RPC round-trip
        // of the fill, without waiting for the next poll tick.
        pollRef.current()

        confirmSignature(connection, res.signature).then((result) => {
          const s = useStore.getState()
          const cur = s.positions.find((p) => p.id === posId)
          // Don't resurrect a position a sell/close already took over.
          if (
            !cur ||
            cur.status === 'closed' ||
            cur.status === 'selling' ||
            cur.status === 'failed'
          ) {
            return
          }
          if (result === 'confirmed') {
            s.updatePosition(posId, { status: 'open' })
            s.log('success', `BUY confirmed ${sym}`)
            refreshBalance()
          } else if (result === 'failed') {
            // Proven on-chain failure — safe to untrack and refund the cap.
            s.updatePosition(posId, { status: 'failed', error: 'buy reverted' })
            s.log('error', `BUY failed ${sym}`)
            removeMapping(token.mint, posId)
            pumpPortal.unwatchTrades(token.mint)
            s.addSpend(-invested)
            refreshBalance()
          } else {
            // timeout — the tx may still land; KEEP the position tracked.
            s.updatePosition(posId, {
              status: 'open',
              error: 'unconfirmed within 30s',
            })
            s.log('warn', `BUY unconfirmed (kept, may still land) ${sym}`)
            refreshBalance()
          }
        })
      } catch (e) {
        // Build/sign/send never landed a tx: untrack and refund the cap.
        const s = useStore.getState()
        const msg = (e as Error).message
        s.updatePosition(posId, { status: 'failed', error: msg })
        s.log('error', `BUY error: ${msg}${errorHint(msg)}`)
        removeMapping(token.mint, posId)
        pumpPortal.unwatchTrades(token.mint)
        s.addSpend(-invested)
      } finally {
        inFlight.current.delete(token.mint)
      }
    },
    [connection, refreshBalance, sign],
  )

  const onTrade = useCallback(
    (u: TradeUpdate) => {
      const set = posByMint.current.get(u.mint)
      if (!set || set.size === 0) return
      if (u.priceSol == null) return
      const s = useStore.getState()
      for (const posId of set) {
        const pos = s.positions.find((p) => p.id === posId)
        if (!pos) continue

        // First real price after our buy establishes the entry baseline.
        const patch: Partial<Position> = { lastPriceSol: u.priceSol }
        if (pos.entryPriceSol == null) {
          patch.entryPriceSol = u.priceSol
          if (pos.tokenAmount == null && u.priceSol > 0) {
            patch.tokenAmount = pos.investedSol / u.priceSol
          }
        }
        s.updatePosition(posId, patch)

        // TP/SL only on confirmed, not-being-sold positions.
        if (pos.status !== 'open') continue
        const entry = pos.entryPriceSol ?? patch.entryPriceSol
        if (!entry) continue
        const pnl = ((u.priceSol - entry) / entry) * 100
        if (!s.config.autoManage) continue
        if (pnl >= pos.takeProfitPct) {
          s.log('info', `TP ${pnl.toFixed(1)}% ${pos.symbol || shortAddr(pos.mint)}`)
          void sellPosition(posId, 'take-profit')
        } else if (pnl <= -pos.stopLossPct) {
          s.log('info', `SL ${pnl.toFixed(1)}% ${pos.symbol || shortAddr(pos.mint)}`)
          void sellPosition(posId, 'stop-loss')
        }
      }
    },
    [sellPosition],
  )

  const onNewToken = useCallback(
    (raw: TokenEvent) => {
      // Never surface or trade base assets / stables that can't be sniped.
      if (BLOCKED_MINTS.has(raw.mint)) return
      const s = useStore.getState()
      const t = withUsd(raw, s.solUsd)
      // Always surface detected tokens so the feed reflects live activity; the
      // mcap/liquidity range gates which ones are AUTO-BOUGHT, not detection.
      s.pushToken(t)
      if (!s.running || !s.config.autoSnipe) return
      const sym = t.symbol || shortAddr(t.mint)
      const cfg = s.config
      // Gate 1: USD market-cap / liquidity range (throttled skip log).
      if (!passesDetection(t, cfg)) {
        const now = Date.now()
        if (now - lastSkipLog.current > 3000) {
          lastSkipLog.current = now
          const mc = t.marketCapUsd != null
            ? `$${Math.round(t.marketCapUsd).toLocaleString()}`
            : '?'
          const lq = t.liquidityUsd != null
            ? `$${Math.round(t.liquidityUsd).toLocaleString()}`
            : '?'
          s.log('info', `skip ${sym}: mc ${mc} / liq ${lq} outside filter range`)
        }
        return
      }
      // Gate 2: dev-buy (off by default; logged when it blocks so it's never silent).
      if (
        cfg.maxDevBuySol > 0 &&
        t.devBuySol != null &&
        t.devBuySol > cfg.maxDevBuySol
      ) {
        s.log(
          'info',
          `skip ${sym}: dev buy ${fmtSol(t.devBuySol)}◎ > max ${cfg.maxDevBuySol}◎ (set max dev buy to 0 to allow)`,
        )
        return
      }
      if (t.source === 'dexscreener' && !isDexSnipeable(t)) {
        s.log('info', `skip ${sym}: dexscreener pair not fresh/snipeable`)
        return
      }
      void snipe(t, true)
    },
    [snipe],
  )

  // Engine wiring: register once, tear down on unmount.
  useEffect(() => {
    const unsubStatus = pumpPortal.onStatus((st) =>
      useStore.getState().setPumpStatus(st),
    )
    const unsubNew = pumpPortal.onNewToken(onNewToken)
    const unsubTrade = pumpPortal.onTrade(onTrade)

    dexPoller.current = new DexScreenerPoller((t) => onNewToken(t))

    return () => {
      unsubStatus()
      unsubNew()
      unsubTrade()
      dexPoller.current?.stop()
      dexPoller.current = null
    }
  }, [onNewToken, onTrade])

  // Balance polling while a wallet is present.
  useEffect(() => {
    if (!address) {
      useStore.getState().setBalance(null)
      return
    }
    refreshBalance()
    const id = setInterval(refreshBalance, 15000)
    return () => clearInterval(id)
  }, [address, refreshBalance])

  // Keep a live SOL/USD price so pump.fun SOL values can be filtered in USD.
  useEffect(() => {
    const ac = new AbortController()
    const load = () =>
      fetchSolPriceUsd(ac.signal).then((p) => {
        if (p) useStore.getState().setSolUsd(p)
      })
    void load()
    const id = setInterval(() => void load(), 30000)
    return () => {
      clearInterval(id)
      ac.abort()
    }
  }, [])

  // Live PnL for held positions. Prices come from the fastest key-free source:
  // pump.fun mints are read straight from their on-chain bonding curve (no
  // indexing delay — works the instant a coin is bought), everything else falls
  // back to DexScreener. A buy also triggers this immediately (see snipe), so
  // PnL starts moving within an RPC round-trip of the fill.
  const pollPrices = useCallback(async () => {
    const g = useStore.getState()
    const live = g.positions.filter((p) => LIVE_STATES.has(p.status))
    if (live.length === 0) return

    const pumpMints = [
      ...new Set(live.filter((p) => p.pool === 'pump').map((p) => p.mint)),
    ]
    const otherMints = [
      ...new Set(live.filter((p) => p.pool !== 'pump').map((p) => p.mint)),
    ]

    const [pumpPrices, otherPrices] = await Promise.all([
      pumpMints.length
        ? fetchBondingCurvePrices(pumpMints)
        : Promise.resolve(new Map<string, number>()),
      otherMints.length
        ? fetchPricesSol(otherMints)
        : Promise.resolve(new Map<string, number>()),
    ])
    const prices = new Map<string, number>([...otherPrices, ...pumpPrices])

    // pump mints with no live curve (migrated) — try DexScreener as a fallback.
    const missing = pumpMints.filter((m) => !prices.has(m))
    if (missing.length) {
      const dx = await fetchPricesSol(missing)
      for (const [k, v] of dx) prices.set(k, v)
    }
    if (prices.size === 0) return

    const s = useStore.getState()
    for (const p of s.positions) {
      if (!LIVE_STATES.has(p.status)) continue
      const price = prices.get(p.mint)
      if (price == null) continue
      const patch: Partial<Position> = { lastPriceSol: price }
      if (p.entryPriceSol == null) {
        patch.entryPriceSol = price
        if (p.tokenAmount == null && price > 0) {
          patch.tokenAmount = p.investedSol / price
        }
      }
      s.updatePosition(p.id, patch)

      if (p.status !== 'open' || !s.config.autoManage) continue
      const entry = p.entryPriceSol ?? patch.entryPriceSol
      if (!entry) continue
      const pnl = ((price - entry) / entry) * 100
      if (pnl >= p.takeProfitPct) {
        s.log('info', `TP ${pnl.toFixed(1)}% ${p.symbol || shortAddr(p.mint)}`)
        void sellPosition(p.id, 'take-profit')
      } else if (pnl <= -p.stopLossPct) {
        s.log('info', `SL ${pnl.toFixed(1)}% ${p.symbol || shortAddr(p.mint)}`)
        void sellPosition(p.id, 'stop-loss')
      }
    }
  }, [sellPosition])

  pollRef.current = () => void pollPrices()

  useEffect(() => {
    void pollPrices()
    const id = setInterval(() => void pollPrices(), PRICE_POLL_MS)
    return () => clearInterval(id)
  }, [pollPrices])

  const start = useCallback(() => {
    const g = useStore.getState()
    if (g.running) return
    if (!addrRef.current) {
      g.log('error', 'connect a wallet before starting the engine')
      return
    }
    g.setRunning(true)
    g.log('system', 'ENGINE START — scanning pump.fun + dexscreener')
    g.log(
      'info',
      `RPC pool: ${readPoolSize} free endpoints (round-robin + failover)`,
    )
    g.log(
      'info',
      PUMPPORTAL_HAS_KEY
        ? 'position PnL: real-time PumpPortal trade stream + on-chain bonding curve'
        : 'position PnL: live on-chain bonding curve (pump.fun) + DexScreener (~2s)',
    )
    pumpPortal.connect()
    pumpPortal.subscribeNewTokens()
    dexPoller.current?.start()
    useStore.getState().setDexStatus('connected')
  }, [])

  const stop = useCallback(() => {
    const g = useStore.getState()
    if (!g.running) return
    g.setRunning(false)
    g.log('system', 'ENGINE STOP — detection halted (positions still managed)')
    pumpPortal.unsubscribeNewTokens()
    dexPoller.current?.stop()
    useStore.getState().setDexStatus('disconnected')
  }, [])

  const manualBuy = useCallback(
    (mint: string, amountSol?: number) => {
      const token: TokenEvent = {
        mint: mint.trim(),
        source: 'pumpfun',
        pool: 'auto',
        detectedAt: Date.now(),
      }
      if (!addrRef.current) {
        useStore.getState().log('error', 'connect a wallet first')
        return
      }
      // Ensure the socket is live so we can track price for TP/SL.
      pumpPortal.connect()
      void snipe(token, false, amountSol)
    },
    [snipe],
  )

  const closeAll = useCallback(() => {
    const g = useStore.getState()
    const open = g.positions.filter((p) => p.status === 'open')
    if (open.length === 0) {
      g.log('info', 'no open positions to close')
      return
    }
    g.log('system', `closing ${open.length} position(s)`)
    for (const p of open) void sellPosition(p.id, 'close-all')
  }, [sellPosition])

  return {
    ready: !!address,
    address,
    start,
    stop,
    manualBuy,
    sellPosition: (id, reason) => void sellPosition(id, reason),
    closeAll,
    refreshBalance,
  }
}
