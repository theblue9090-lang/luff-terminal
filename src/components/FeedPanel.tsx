import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { ago, fmtSol, shortAddr } from '../lib/format'
import type { SniperApi } from '../hooks/useSniper'

export function FeedPanel({ api }: { api: SniperApi }) {
  const feed = useStore((s) => s.feed)
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
          feed.map((t) => (
            <div className="row feed-row" key={t.mint}>
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
          ))
        )}
      </div>
    </div>
  )
}
