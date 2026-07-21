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
import { PUMPPORTAL_TRADE_URL } from '../config'
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
 */
export async function executeTrade(
  params: TradeParams,
  sign: SignFn,
  connection: Connection,
  signal?: AbortSignal,
): Promise<TradeResult> {
  const t0 = performance.now()

  const tx = await buildTx(params, signal)

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
 * Best-effort confirmation without blocking the hot path. Resolves to true if
 * the tx is confirmed within `timeoutMs`, false otherwise (never throws).
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  timeoutMs = 30000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const st = await connection.getSignatureStatuses([signature])
      const s = st.value[0]
      if (s) {
        if (s.err) return false
        if (
          s.confirmationStatus === 'confirmed' ||
          s.confirmationStatus === 'finalized'
        ) {
          return true
        }
      }
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
  return false
}

export { TradeError }
