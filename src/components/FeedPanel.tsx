import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { ago, fmtSol, shortAddr } from '../lib/format'
import type { SnipeConfig } from '../config'
import type { TokenEvent } from '../types'
import type { SniperApi } from '../hooks/useSniper'

/** Does this token fall within the configured auto-snipe mcap/liquidity range? */
function isEligible(t: TokenEvent, cfg: SnipeConfig): boolean {
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

export function FeedPanel({ api }: { api: SniperApi }) {
  const feed = useStore((s) => s.feed)
  const config = useStore((s) => s.config)
  const clearFeed = useStore((s) => s.clearFeed)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">📡 live feed · new tokens</span>
        <button className="btn sm" onClick={clearFeed}>
          clear
        </button>
      </div>
      <div className="panel-body">
        {feed.length === 0 ? (
          <div className="empty">
            no tokens yet — press START ENGINE to begin scanning pump.fun +
            dexscreener
          </div>
        ) : (
          feed.map((t) => {
            const eligible = isEligible(t, config)
            return (
              <div
                className={`row feed-row${eligible ? '' : ' dim'}`}
                key={t.mint}
                title={
                  eligible
                    ? 'within snipe filters'
                    : 'outside snipe filters — shown for reference'
                }
              >
                <div style={{ minWidth: 0 }}>
                  <div className="sym">
                    <span className={`badge ${t.source}`}>
                      {t.source === 'pumpfun' ? 'PUMP' : 'DEX'}
                    </span>{' '}
                    {t.symbol || shortAddr(t.mint)}{' '}
                    {t.name && (
                      <span className="sub">
                        {t.name.length > 22 ? t.name.slice(0, 22) + '…' : t.name}
                      </span>
                    )}
                  </div>
                  <div className="sub">
                    {shortAddr(t.mint, 6, 6)}
                    {t.marketCapUsd != null &&
                      ` · mc $${Math.round(t.marketCapUsd).toLocaleString()}`}
                    {t.liquidityUsd != null &&
                      ` · liq $${Math.round(t.liquidityUsd).toLocaleString()}`}
                    {t.devBuySol != null && ` · dev ${fmtSol(t.devBuySol)}◎`}
                    {' · '}
                    {ago(t.detectedAt, now)}
                  </div>
                </div>
                <div className="muted mono-xs">
                  {t.priceSol != null ? `${t.priceSol.toExponential(2)}◎` : ''}
                </div>
                <button
                  className="btn sm primary"
                  onClick={() => api.manualBuy(t.mint)}
                  disabled={!api.ready}
                  title="buy now"
                >
                  snipe
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
