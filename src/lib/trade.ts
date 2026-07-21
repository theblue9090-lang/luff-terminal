// -----------------------------------------------------------------------------
// Trade execution pipeline.
//
// Flow (self-custodial / "local" PumpPortal API):
//   1) POST trade params to PumpPortal trade-local -> serialized unsigned tx.
//   2) Sign the tx with the user's Privy embedded wallet (no modal when
//      showWalletUIs=false).
//   3) Broadcast the raw signed tx via our own RPC with skipPreflight for speed.
//
// We never send the user's key anywhere: PumpPortal only builds the tx, Privy
// holds the key, and we broadcast the signed bytes ourselves.
// -----------------------------------------------------------------------------

import {
  Connection,
  VersionedTransaction,
  Transaction,
} from '@solana/web3.js'
import { BUILD_TIMEOUT_MS, PUMPPORTAL_TRADE_URL } from '../config'
import type { Pool } from '../types'

export type TradeAction = 'buy' | 'sell'

/** A Privy-style signer: takes an unsigned tx, returns a signed one. */
export type SignFn = (args: {
  transaction: VersionedTransaction | Transaction
  connection: Connection
}) => Promise<VersionedTransaction | Transaction>

export interface TradeParams {
  action: TradeAction
  mint: string
  publicKey: string
  /** For buys: SOL amount (number). For sells: token amount, or a "100%" string. */
  amount: number | string
  denominatedInSol: boolean
  slippage: number
  priorityFee: number
  pool: Pool
}

export interface TradeResult {
  signature: string
  /** ms spent building + signing + submitting. */
  elapsedMs: number
}

class TradeError extends Error {
  readonly stage: 'build' | 'sign' | 'send'
  constructor(message: string, stage: 'build' | 'sign' | 'send') {
    super(message)
    this.name = 'TradeError'
    this.stage = stage
  }
}

/** Build the unsigned transaction from PumpPortal's local trade endpoint. */
async function buildTx(
  p: TradeParams,
  signal?: AbortSignal,
): Promise<VersionedTransaction> {
  let res: Response
  try {
    res = await fetch(PUMPPORTAL_TRADE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        publicKey: p.publicKey,
        action: p.action,
        mint: p.mint,
        amount: p.amount,
        denominatedInSol: p.denominatedInSol ? 'true' : 'false',
        slippage: p.slippage,
        priorityFee: p.priorityFee,
        pool: p.pool,
      }),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new TradeError('trade-local build timed out', 'build')
    }
    throw new TradeError(
      `network error building tx: ${(e as Error).message}`,
      'build',
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new TradeError(
      `trade-local ${res.status}: ${text.slice(0, 200)}`,
      'build',
    )
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length === 0) {
    throw new TradeError('trade-local returned an empty transaction', 'build')
  }
  try {
    return VersionedTransaction.deserialize(buf)
  } catch (e) {
    throw new TradeError(
      `could not decode transaction: ${(e as Error).message}`,
      'build',
    )
  }
}

/**
 * Execute a trade end to end. `connection` is reused (already warm) so we skip
 * connection setup latency on the hot path.
 *
 * The build request is hard-bounded by `buildTimeoutMs` so a hung PumpPortal
 * request can never stall the trade and leak the caller's in-flight guard.
 */
export async function executeTrade(
  params: TradeParams,
  sign: SignFn,
  connection: Connection,
  signal?: AbortSignal,
  buildTimeoutMs = BUILD_TIMEOUT_MS,
): Promise<TradeResult> {
  const t0 = performance.now()

  // Bound the build phase with our own controller, chained to any caller signal.
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), buildTimeoutMs)
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }
  let tx: VersionedTransaction
  try {
    tx = await buildTx(params, ac.signal)
  } finally {
    clearTimeout(timer)
  }

  let signed: VersionedTransaction | Transaction
  try {
    signed = await sign({ transaction: tx, connection })
  } catch (e) {
    throw new TradeError(`signing failed: ${(e as Error).message}`, 'sign')
  }

  const raw = signed.serialize()
  let signature: string
  try {
    signature = await connection.sendRawTransaction(raw, {
      skipPreflight: true, // speed: don't round-trip a simulation first
      maxRetries: 2,
      preflightCommitment: 'processed',
    })
  } catch (e) {
    throw new TradeError(`broadcast failed: ${(e as Error).message}`, 'send')
  }

  return { signature, elapsedMs: performance.now() - t0 }
}

/**
 * Confirmation outcome. `timeout` is deliberately distinct from `failed`:
 * a Solana tx stays valid until its blockhash expires, so a buy that hasn't
 * confirmed within the window may still land — callers must NOT treat a timeout
 * as a definitive failure (that would orphan a real position).
 */
export type ConfirmResult = 'confirmed' | 'failed' | 'timeout'

/**
 * Confirm a signature, racing the WebSocket `onSignature` push (fires the
 * instant the cluster confirms) against an HTTP poll fallback. Never throws.
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  timeoutMs = 30000,
): Promise<ConfirmResult> {
  // Fast path: WS push. Only ever resolves on a real notification, so it never
  // beats the poll on a subscription error.
  const wsPush = new Promise<ConfirmResult>((resolve) => {
    try {
      connection.onSignature(
        signature,
        (res) => resolve(res.err ? 'failed' : 'confirmed'),
        'confirmed',
      )
    } catch {
      /* leave resolution to the poll fallback */
    }
  })

  // Fallback: poll loop, also covers subscribing after the tx already confirmed.
  const poll = (async (): Promise<ConfirmResult> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const st = await connection.getSignatureStatuses([signature])
        const s = st.value[0]
        if (s) {
          if (s.err) return 'failed'
          if (
            s.confirmationStatus === 'confirmed' ||
            s.confirmationStatus === 'finalized'
          ) {
            return 'confirmed'
          }
        }
      } catch {
        /* keep polling */
      }
      await new Promise((r) => setTimeout(r, 1200))
    }
    return 'timeout'
  })()

  return Promise.race([wsPush, poll])
}

export { TradeError }
