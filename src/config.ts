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
 * Mints that are never snipeable new coins (base assets / stables / LSTs).
 * The DexScreener token-profiles feed can surface these — buying them just
 * returns `trade-local 400`, so we drop them from detection entirely.
 */
export const BLOCKED_MINTS = new Set<string>([
  SOL_MINT,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
])

/** Pools PumpPortal can actually build a snipe trade for. */
export const SNIPEABLE_POOLS = new Set<string>([
  'pump',
  'pump-amm',
  'raydium',
  'raydium-cpmm',
  'launchlab',
  'bonk',
])

/**
 * Max age (minutes) for a DexScreener-sourced token to still be auto-sniped.
 * token-profiles is a promotions feed, not a new-launch feed, so we only
 * auto-buy pairs that enrichment confirms are genuinely fresh.
 */
export const DEX_MAX_AGE_MIN = 15

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

/** The public endpoint rejects transaction sends — used to warn the user. */
export const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com'

/** Derive a WebSocket RPC URL from an HTTP(S) one. */
export function wsFromHttp(url: string): string | undefined {
  if (RPC_WS_ENDPOINT) return RPC_WS_ENDPOINT
  try {
    const u = new URL(url)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return u.toString()
  } catch {
    return undefined
  }
}

const RPC_STORAGE_KEY = 'luff.rpcUrl'

/** Load the user's saved RPC override, falling back to the env/default. */
export function loadRpcUrl(): string {
  try {
    return localStorage.getItem(RPC_STORAGE_KEY) || RPC_ENDPOINT
  } catch {
    return RPC_ENDPOINT
  }
}

/** Persist the user's RPC override (empty string clears it). */
export function saveRpcUrl(url: string): void {
  try {
    if (url) localStorage.setItem(RPC_STORAGE_KEY, url)
    else localStorage.removeItem(RPC_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

const CONFIG_STORAGE_KEY = 'luff.config'

/** Persist the snipe config so settings survive reloads. */
export function saveConfig(cfg: SnipeConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

/** Load persisted snipe config merged over defaults. */
export function loadConfig(defaults: SnipeConfig): SnipeConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (!raw) return defaults
    return { ...defaults, ...(JSON.parse(raw) as Partial<SnipeConfig>) }
  } catch {
    return defaults
  }
}

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
