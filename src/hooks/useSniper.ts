// -----------------------------------------------------------------------------
// useSniper — the engine.
//
// Wires the two detection feeds (PumpPortal WS + DexScreener poll) to the store,
// runs auto-snipe evaluation on qualifying new tokens, streams live prices for
// held mints, and enforces take-profit / stop-loss. All trades are signed by the
// Privy embedded wallet and broadcast through one warm RPC connection.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
import { useSolanaWallets, useSignTransaction } from '@privy-io/react-auth/solana'
import { RPC_ENDPOINT, RPC_WS_ENDPOINT, type SnipeConfig } from '../config'
import type { Position, TokenEvent } from '../types'
import { useStore } from '../state/store'
import { pumpPortal, type TradeUpdate } from '../lib/pumpportal'
import { DexScreenerPoller } from '../lib/dexscreener'
import { confirmSignature, executeTrade, type SignFn } from '../lib/trade'
import { shortAddr } from '../lib/format'

function passesFilters(t: TokenEvent, cfg: SnipeConfig): boolean {
  if (cfg.maxDevBuySol > 0 && t.devBuySol != null && t.devBuySol > cfg.maxDevBuySol) {
    return false
  }
  if (
    cfg.minLiquiditySol > 0 &&
    t.vSolInBondingCurve != null &&
    t.vSolInBondingCurve < cfg.minLiquiditySol
  ) {
    return false
  }
  return true
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

  const wallet = wallets[0]
  const address = wallet?.address

  const connection = useMemo(
    () =>
      new Connection(RPC_ENDPOINT, {
        commitment: 'confirmed',
        wsEndpoint: RPC_WS_ENDPOINT,
      }),
    [],
  )

  // Keep the latest signer / address in refs so hot-path callbacks stay stable.
  const signRef = useRef<SignFn>(signTransaction as unknown as SignFn)
  signRef.current = signTransaction as unknown as SignFn
  const addrRef = useRef<string | undefined>(address)
  addrRef.current = address

  // Guards against duplicate concurrent trades keyed by mint (buys) / posId (sells).
  const inFlight = useRef(new Set<string>())
  // Map of mint -> open position id, so trade updates find their position.
  const posByMint = useRef(new Map<string, string>())
  const dexPoller = useRef<DexScreenerPoller | null>(null)

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
      if (pos.status !== 'open' && pos.status !== 'buying') return
      const addr = addrRef.current
      if (!addr) {
        g.log('error', 'cannot sell: no wallet')
        return
      }
      const key = 'sell:' + posId
      if (inFlight.current.has(key)) return
      inFlight.current.add(key)

      const cfg = g.config
      g.updatePosition(posId, { status: 'selling' })
      g.log('trade', `SELL ${pos.symbol || shortAddr(pos.mint)} (${reason})`)
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
          signRef.current,
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
        confirmSignature(connection, res.signature).then((ok) => {
          const s = useStore.getState()
          if (ok) {
            s.updatePosition(posId, {
              status: 'closed',
              closedAt: Date.now(),
              exitProceedsSol: proceeds,
            })
            s.log('success', `SELL confirmed ${pos.symbol || shortAddr(pos.mint)}`)
            posByMint.current.delete(pos.mint)
            pumpPortal.unwatchTrades(pos.mint)
            refreshBalance()
          } else {
            // Reopen so the user (or auto-manage) can retry.
            s.updatePosition(posId, { status: 'open' })
            s.log('warn', `SELL not confirmed, position kept open`)
          }
        })
      } catch (e) {
        useStore
          .getState()
          .updatePosition(posId, { status: 'open', error: (e as Error).message })
        useStore.getState().log('error', `SELL error: ${(e as Error).message}`)
      } finally {
        inFlight.current.delete(key)
      }
    },
    [connection, refreshBalance],
  )

  const snipe = useCallback(
    async (token: TokenEvent, auto: boolean, amountOverride?: number) => {
      const g = useStore.getState()
      const cfg = g.config
      const addr = addrRef.current
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

      inFlight.current.add(token.mint)
      const posId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${token.mint}-${Date.now()}`
      const invested = amountOverride ?? cfg.buyAmountSol
      const entry = token.priceSol
      const position: Position = {
        id: posId,
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        pool: token.pool,
        status: 'buying',
        investedSol: invested,
        entryPriceSol: entry,
        lastPriceSol: entry,
        tokenAmount: entry && entry > 0 ? invested / entry : undefined,
        openedAt: Date.now(),
        takeProfitPct: cfg.takeProfitPct,
        stopLossPct: cfg.stopLossPct,
      }
      g.addPosition(position)
      g.log(
        'trade',
        `BUY ${token.symbol || shortAddr(token.mint)} ${invested} SOL [${token.pool}]${auto ? ' (auto)' : ''}`,
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
          signRef.current,
          connection,
        )
        useStore.getState().updatePosition(posId, { buySignature: res.signature })
        useStore
          .getState()
          .log(
            'success',
            `BUY sent ${token.symbol || shortAddr(token.mint)} ${shortAddr(res.signature)} in ${res.elapsedMs.toFixed(0)}ms`,
          )
        posByMint.current.set(token.mint, posId)
        pumpPortal.watchTrades(token.mint)

        confirmSignature(connection, res.signature).then((ok) => {
          const s = useStore.getState()
          const cur = s.positions.find((p) => p.id === posId)
          if (!cur || cur.status === 'closed') return
          if (ok) {
            s.updatePosition(posId, { status: 'open' })
            s.log('success', `BUY confirmed ${token.symbol || shortAddr(token.mint)}`)
            refreshBalance()
          } else {
            s.updatePosition(posId, {
              status: 'failed',
              error: 'buy not confirmed',
            })
            s.log('error', `BUY failed ${token.symbol || shortAddr(token.mint)}`)
            posByMint.current.delete(token.mint)
            pumpPortal.unwatchTrades(token.mint)
          }
        })
      } catch (e) {
        useStore
          .getState()
          .updatePosition(posId, { status: 'failed', error: (e as Error).message })
        useStore.getState().log('error', `BUY error: ${(e as Error).message}`)
      } finally {
        inFlight.current.delete(token.mint)
      }
    },
    [connection, refreshBalance],
  )

  const onTrade = useCallback(
    (u: TradeUpdate) => {
      const posId = posByMint.current.get(u.mint)
      if (!posId) return
      const s = useStore.getState()
      const pos = s.positions.find((p) => p.id === posId)
      if (!pos) return
      if (u.priceSol == null) return

      // First real price after a market buy becomes the entry reference.
      const patch: Partial<Position> = { lastPriceSol: u.priceSol }
      if (pos.entryPriceSol == null) {
        patch.entryPriceSol = u.priceSol
        if (pos.tokenAmount == null && u.priceSol > 0) {
          patch.tokenAmount = pos.investedSol / u.priceSol
        }
      }
      s.updatePosition(posId, patch)

      if (pos.status !== 'open') return
      const entry = pos.entryPriceSol ?? patch.entryPriceSol
      if (!entry) return
      const pnl = ((u.priceSol - entry) / entry) * 100
      if (!s.config.autoManage) return
      if (pnl >= pos.takeProfitPct) {
        s.log('info', `TP ${pnl.toFixed(1)}% ${pos.symbol || shortAddr(pos.mint)}`)
        void sellPosition(posId, 'take-profit')
      } else if (pnl <= -pos.stopLossPct) {
        s.log('info', `SL ${pnl.toFixed(1)}% ${pos.symbol || shortAddr(pos.mint)}`)
        void sellPosition(posId, 'stop-loss')
      }
    },
    [sellPosition],
  )

  const onNewToken = useCallback(
    (t: TokenEvent) => {
      const s = useStore.getState()
      s.pushToken(t)
      if (s.running && s.config.autoSnipe && passesFilters(t, s.config)) {
        void snipe(t, true)
      }
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

  const start = useCallback(() => {
    const g = useStore.getState()
    if (g.running) return
    if (!addrRef.current) {
      g.log('error', 'connect a wallet before starting the engine')
      return
    }
    g.setRunning(true)
    g.log('system', 'ENGINE START — scanning pump.fun + dexscreener')
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
    const open = g.positions.filter(
      (p) => p.status === 'open' || p.status === 'buying',
    )
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
