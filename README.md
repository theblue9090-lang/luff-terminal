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
- **Auto take-profit / stop-loss** — held positions are tracked in real time via
  the PumpPortal per-token trade stream and auto-sold when your TP/SL triggers.
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

### Hands-free (no-confirmation) trading

Buys and sells never show a confirmation popup — the app configures the Privy
embedded wallet with `showWalletUIs: false`, so signing is silent by design.
For an explicit, one-time authorization, click **⚡ HANDS-FREE** in the header:
this *delegates* your embedded wallet via Privy's headless delegation so the
sniper is authorized to transact on your behalf and will never ask again. Click
it again any time to revoke. Delegation is optional — silent signing works
without it — but it's the cleanest way to guarantee zero interruptions during
auto-snipe.

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
| Max dev buy (SOL) | Skip pump.fun tokens whose creator bought more than this (0 = off) |
| Min liq (SOL) | Skip tokens with less bonding-curve liquidity (0 = off) |

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

## Disclaimer

This is experimental software that moves real money on a live blockchain. There
are no refunds for a bad trade, a rug, a bug, or a mis-click. Review the code,
start with tiny amounts, and understand that you are fully responsible for any
funds you put through it.
