// -----------------------------------------------------------------------------
// Central configuration. Everything that might change per-deployment is read
// from Vite env vars (prefixed VITE_) with a sensible default baked in so the
// app runs out of the box.
// -----------------------------------------------------------------------------

const env = import.meta.env

const DEV = env.DEV

/** Privy application id. Provided by the user; overridable via env. */
export const PRIVY_APP_ID: string =
  (env.VITE_PRIVY_APP_ID as string | undefined) ?? 'cmrpmbbsc00f50djv46ahai5g'

/**
 * Solana mainnet RPC endpoint. The public endpoint is heavily rate limited and
 * NOT suitable for competitive sniping — set VITE_SOLANA_RPC to a paid RPC
 * (Helius / QuickNode / Triton) for real use.
 */
export const RPC_ENDPOINT: string =
  (env.VITE_SOLANA_RPC as string | undefined) ??
  'https://api.mainnet-beta.solana.com'

/** Optional dedicated WebSocket RPC (falls back to deriving from RPC_ENDPOINT). */
export const RPC_WS_ENDPOINT: string | undefined = env.VITE_SOLANA_RPC_WS as
  | string
  | undefined

/**
 * PumpPortal real-time data websocket. Free for subscribeNewToken /
 * subscribeTokenTrade. An api-key is only needed for the Lightning trade API,
 * which this app does not use (we self-sign via trade-local).
 */
export const PUMPPORTAL_WS: string =
  (env.VITE_PUMPPORTAL_WS as string | undefined) ??
  'wss://pumpportal.fun/api/data'

/**
 * PumpPortal "local" trade endpoint. Returns a serialized, unsigned
 * transaction that we sign with the Privy embedded wallet and broadcast
 * ourselves. In dev we go through the Vite proxy (/pp) to dodge CORS; in prod
 * we hit the host directly (it sends `access-control-allow-origin: *`).
 */
export const PUMPPORTAL_TRADE_URL: string =
  (env.VITE_PUMPPORTAL_TRADE_URL as string | undefined) ??
  (DEV ? '/pp/api/trade-local' : 'https://pumpportal.fun/api/trade-local')

/** DexScreener REST base. */
export const DEXSCREENER_BASE: string =
  (env.VITE_DEXSCREENER_BASE as string | undefined) ??
  (DEV ? '/ds' : 'https://api.dexscreener.com')

/** WSOL / SOL mint used for price math and DexScreener quote-token checks. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112'

/**
 * Headroom kept aside on every buy for the base signature fee + a little rent,
 * so a snipe is never attempted with a balance that can't cover fees.
 */
export const FEE_BUFFER_SOL = 0.003

/** Hard deadline for the PumpPortal trade-local build request (ms). */
export const BUILD_TIMEOUT_MS = 3000

/** Solana clusters config passed to Privy for embedded-wallet signing. */
export const SOLANA_CLUSTERS = [
  { name: 'mainnet-beta' as const, rpcUrl: RPC_ENDPOINT },
]

/** Default snipe parameters — user-tunable at runtime in the UI. */
export const DEFAULT_SNIPE = {
  /** SOL spent per snipe. */
  buyAmountSol: 0.05,
  /** Percent slippage tolerance sent to PumpPortal. */
  slippage: 15,
  /** Priority fee in SOL. Higher = faster inclusion, more cost. */
  priorityFee: 0.0005,
  /** Take-profit trigger, percent gain. */
  takeProfitPct: 60,
  /** Stop-loss trigger, percent loss (positive number). */
  stopLossPct: 35,
  /** Auto-fire buys on qualifying new tokens. */
  autoSnipe: false,
  /** Auto-close positions when TP/SL is hit. */
  autoManage: true,
  /** Max simultaneous open positions when auto-sniping. */
  maxOpenPositions: 3,
  /** Reject tokens whose initial dev buy (SOL) exceeds this. 0 = no cap. */
  maxDevBuySol: 2,
  /** Only snipe tokens with at least this initial liquidity (SOL). */
  minLiquiditySol: 0,
  /** Cumulative SOL this session may spend on buys. 0 = unlimited. */
  maxSpendSol: 1,
}

export type SnipeConfig = typeof DEFAULT_SNIPE
