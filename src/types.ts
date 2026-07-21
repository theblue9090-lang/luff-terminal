// Shared domain types used across the sniper engine and UI.

export type Pool =
  | 'pump'
  | 'pump-amm'
  | 'raydium'
  | 'raydium-cpmm'
  | 'launchlab'
  | 'bonk'
  | 'auto'

export type TokenSource = 'pumpfun' | 'dexscreener'

/** A freshly detected token surfaced by one of the feeds. */
export interface TokenEvent {
  mint: string
  name?: string
  symbol?: string
  source: TokenSource
  pool: Pool
  /** ISO-ish millisecond timestamp of detection. */
  detectedAt: number
  /** Creator / dev wallet if known. */
  creator?: string
  /** Dev's initial buy in SOL, when reported by the feed. */
  devBuySol?: number
  /** Estimated SOL price per token at detection, if computable. */
  priceSol?: number
  /** Market cap in SOL, when reported. */
  marketCapSol?: number
  /** Virtual SOL reserves in the bonding curve (pump). */
  vSolInBondingCurve?: number
  /** Virtual token reserves in the bonding curve (pump). */
  vTokensInBondingCurve?: number
  /** Liquidity in USD (dexscreener). */
  liquidityUsd?: number
  /** Metadata / image URI when available. */
  uri?: string
}

export type PositionStatus =
  | 'buying'
  | 'open'
  | 'selling'
  | 'closed'
  | 'failed'

/** An open or historical sniper position. */
export interface Position {
  id: string
  mint: string
  symbol?: string
  name?: string
  pool: Pool
  status: PositionStatus
  /** SOL committed to the buy. */
  investedSol: number
  /** SOL price per token at entry. */
  entryPriceSol?: number
  /** Latest observed SOL price per token. */
  lastPriceSol?: number
  /** Token quantity acquired (best-effort, may be approximate). */
  tokenAmount?: number
  /** Realized/settled proceeds in SOL after a sell. */
  exitProceedsSol?: number
  openedAt: number
  closedAt?: number
  buySignature?: string
  sellSignature?: string
  /** Take-profit / stop-loss snapshot at open (percent). */
  takeProfitPct: number
  stopLossPct: number
  error?: string
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'trade' | 'system'

export interface LogEntry {
  id: number
  ts: number
  level: LogLevel
  msg: string
}

export type FeedStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
