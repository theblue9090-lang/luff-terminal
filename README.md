# LUFF·SNIPER

A browser-based **terminal for sniping brand-new Solana tokens** the instant they
launch on **pump.fun** and appear on **DexScreener** — running on **mainnet**,
with wallet auth handled by **Privy** embedded wallets.

Built for speed: detection is event-driven over a persistent WebSocket (no
polling lag), transactions are self-signed and broadcast with `skipPreflight`
through your own RPC, and buys/sells fire without a wallet popup so auto-snipe
can react in milliseconds.

> ⚠️ **REAL FUNDS · MAINNET · EXTREME RISK.** Sniping newly launched tokens is
> one of the riskiest activities in crypto. The overwhelming majority of new
> tokens go to zero, and rugs/honeypots (tokens you can buy but can't sell) are
> common. Only fund the wallet with SOL you can afford to lose completely. This
> software is provided as-is, for educational purposes, and is **not financial
> advice**.

---

## Features

- **Two live feeds**
  - **pump.fun** via the PumpPortal `subscribeNewToken` WebSocket — pushes every
    token-creation the moment it lands.
  - **DexScreener** via the latest-token-profiles feed, enriched with live
    price/liquidity.
- **Auto-snipe** — automatically buy any new token that passes your filters
  (max dev-buy, min liquidity, max open positions).
- **Real-time position PnL** — pump.fun prices are read straight from the
  on-chain **bonding curve** over RPC (no indexing delay — PnL is live within an
  RPC round-trip of the fill, and a buy triggers an immediate read), refreshed
  every ~2s; non-pump tokens use DexScreener. Set `VITE_PUMPPORTAL_API_KEY` to
  also get PumpPortal's real-time trade stream.
- **Auto take-profit / stop-loss** — positions are auto-sold when your TP/SL
  triggers, driven by the same live price updates.
- **No-confirmation auto-buy** — the embedded wallet signs every buy/sell
  *silently* (`showWalletUIs: false`), so auto-snipe fires with **zero popups**.
  A one-click **⚡ Hands-free** toggle additionally *delegates* the wallet
  (Privy headless delegation) so it's explicitly authorized once and never asks
  again; fully revocable.
- **Self-custodial trades** — PumpPortal only *builds* the transaction; your
  Privy embedded wallet signs it; the app broadcasts it. Your key never leaves
  Privy.
- **Safety rails** — per-buy balance check, a session spend cap, a max-open-
  positions limit, and duplicate-buy guards so a runaway feed can't drain the
  wallet.
- **PnL dashboard** — a live stats strip (total / realized / unrealized PnL,
  open value, win rate, best & worst trade, session spend) plus a positions
  panel with per-position PnL in % and SOL, entry→current price, and an
  open / history split.
- **Terminal UX** — live feed, positions with PnL, console log, and a command
  bar (`buy`, `sell`, `set`, `auto on/off`, `start/stop`, `closeall`).

## How it works

```
 pump.fun ──subscribeNewToken──┐
                               ├──► detection ──► filters ──► BUY ──┐
 DexScreener ──token-profiles──┘                                    │
                                                                    ▼
                              PumpPortal /trade-local  ──►  unsigned tx
                                                                    │
                                          Privy embedded wallet  (sign)
                                                                    │
                                    your Solana RPC  (sendRawTransaction)
                                                                    │
        subscribeTokenTrade (live price) ──► TP / SL monitor ──► SELL
```

## Quick start

```bash
npm install
cp .env.example .env.local   # then edit — set a paid RPC!
npm run dev
```

Open the printed localhost URL, click **CONNECT WITH PRIVY**, and a Solana
embedded wallet is created for you automatically. **Fund that wallet's address
with SOL** (shown in the header), tune your config, then press **START ENGINE**.

### RPC endpoints (multi-RPC, no setup)

Runs on mainnet with a **pool of free, no-key RPCs** out of the box — no setup:

- **Reads** (on-chain bonding-curve price polls, balances) are **round-robined
  across the whole pool** (PublicNode, official, dRPC, Omnia, Ankr, OnFinality,
  rpcpool) with a per-request timeout and automatic failover. Spreading the load
  means no single endpoint gets rate-limited, and failing past a slow/erroring
  one means the price poll never stalls — so PnL stays live with no limit/delay.
- **Sends** (every buy/sell) are **sprayed to all send-capable free RPCs in
  parallel**; the first to accept the tx wins. This routes around any RPC that
  blocks or throttles `sendTransaction` (the cause of `broadcast failed: 403`)
  and lands the tx faster.

Free RPCs are still slower than dedicated infra. For competitive sniping set
`VITE_SOLANA_RPC` in `.env.local` to a paid RPC
([Helius](https://helius.dev), [QuickNode](https://quicknode.com),
[Triton](https://triton.one)) — it's placed first in both the read pool and the
send spray.

### Hands-free (no-confirmation) trading

Buys and sells **never show a confirmation popup** — the app configures the Privy
embedded wallet with `showWalletUIs: false` and passes it on every signature, so
signing is silent by design. On top of that, hands-free is **auto-enabled on
login**: the moment your embedded wallet is ready it is *delegated* (Privy
headless delegation), so auto-snipe fires with zero confirmation and no clicking
required. The **⚡ HANDS-FREE** button in the header shows the state and lets you
revoke; a manual revoke is remembered so it won't silently re-enable.

## Configuration

All settings are editable live in the left panel (or via the `set` command):

| Setting | Meaning |
|---|---|
| Buy (SOL) | SOL spent per snipe |
| Max positions | Cap on concurrent auto-snipe positions |
| Slippage % | Slippage tolerance sent to PumpPortal |
| Priority (SOL) | Priority fee — **higher = faster inclusion**, more cost |
| Take profit % | Auto-sell when a position gains this much |
| Stop loss % | Auto-sell when a position loses this much |
| Min / Max mcap ($) | Only DETECT coins within this market-cap range, USD (0 = off). Default min $3k |
| Min liq ($) | Only detect coins with at least this liquidity, USD (0 = off). Default $2k |
| Max dev buy (SOL) | Skip pump.fun tokens whose creator bought more than this (0 = off) |

The live feed shows **every** detected new coin; the market-cap and liquidity
range (USD) gates which ones are **auto-sniped** — coins outside the range are
shown dimmed and are not auto-bought (you can still snipe them manually).
DexScreener reports USD directly; pump.fun values (reported in SOL) are converted
using a live SOL/USD price.

Environment variables (see `.env.example`):

- `VITE_PRIVY_APP_ID` — your Privy app id.
- `VITE_SOLANA_RPC` / `VITE_SOLANA_RPC_WS` — **use a paid RPC** (Helius,
  QuickNode, Triton). The public endpoint is far too slow/rate-limited to win
  snipes.
- `VITE_PUMPPORTAL_*`, `VITE_DEXSCREENER_BASE` — advanced overrides.

## Command bar

```
buy <mint> [sol]     market buy (defaults to configured buy amount)
sell <mint>          sell the full position for a mint
start | stop         toggle the detection engine
closeall             sell every open position
set <key> <value>    e.g. set buyAmountSol 0.1 · set takeProfitPct 80
auto on|off          toggle auto-snipe
clear | help
```

## Going faster

Latency is everything in sniping. To maximize speed:

1. **Use a low-latency paid RPC** geographically close to you (biggest single win).
2. **Raise the priority fee** so validators include your tx sooner.
3. Consider a **Jito** bundle endpoint / staked RPC for landing during
   congestion (point `VITE_SOLANA_RPC` at a staked/Jito-enabled node).
4. Keep the tab focused; browsers throttle background timers/sockets.

## Build & deploy

```bash
npm run build      # type-checks then bundles to dist/
npm run preview    # serve the production build locally
```

`dist/` is a static bundle — deploy to any static host (Vercel, Netlify,
Cloudflare Pages). Add your `VITE_*` env vars in the host's dashboard. In
production the app calls PumpPortal and DexScreener directly (both send permissive
CORS headers); the Vite dev proxy under `/pp` and `/ds` is used only in `npm run dev`.

## Tech

React 19 · TypeScript · Vite · Zustand · `@privy-io/react-auth` (Solana embedded
wallets) · `@solana/web3.js` · PumpPortal local trading API · DexScreener API.

## Custom logo

The brand mark defaults to an original straw-hat icon. To use your own image,
drop a square `public/logo.png` (or `.svg`) — the header and login screen pick
it up automatically, falling back to the straw hat if it's missing. Use art you
have the rights to.

## Disclaimer

This is experimental software that moves real money on a live blockchain. There
are no refunds for a bad trade, a rug, a bug, or a mis-click. Review the code,
start with tiny amounts, and understand that you are fully responsible for any
funds you put through it.
