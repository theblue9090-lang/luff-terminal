import { useStore } from '../state/store'
import { fmtPct, fmtSol, shortAddr } from '../lib/format'
import type { Position } from '../types'
import type { SniperApi } from '../hooks/useSniper'

function pnlPct(p: Position): number | undefined {
  if (p.entryPriceSol == null || p.lastPriceSol == null || p.entryPriceSol === 0) {
    return undefined
  }
  return ((p.lastPriceSol - p.entryPriceSol) / p.entryPriceSol) * 100
}

export function PositionsPanel({ api }: { api: SniperApi }) {
  const positions = useStore((s) => s.positions)

  const open = positions.filter(
    (p) => p.status === 'open' || p.status === 'buying' || p.status === 'selling',
  )

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">💼 positions</span>
        <button
          className="btn sm danger"
          onClick={api.closeAll}
          disabled={open.length === 0}
        >
          close all
        </button>
      </div>
      <div className="panel-body">
        {positions.length === 0 ? (
          <div className="empty">no positions yet</div>
        ) : (
          positions.map((p) => {
            const pnl = pnlPct(p)
            const cls =
              pnl == null ? '' : pnl >= 0 ? 'pnl-pos' : 'pnl-neg'
            const canSell = p.status === 'open' || p.status === 'buying'
            return (
              <div className="row pos-row" key={p.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="sym">
                    {p.symbol || shortAddr(p.mint)}{' '}
                    <span className={`badge`}>{p.pool}</span>
                  </div>
                  <div className="sub">
                    {fmtSol(p.investedSol)}◎ in ·{' '}
                    <span className={`status-pill status-${p.status}`}>
                      {p.status}
                    </span>
                    {p.error && (
                      <span className="log-error"> · {p.error.slice(0, 40)}</span>
                    )}
                  </div>
                </div>
                <div className={`tabular ${cls}`} style={{ textAlign: 'right' }}>
                  {pnl == null ? '—' : fmtPct(pnl)}
                </div>
                <div className="muted mono-xs tabular" style={{ textAlign: 'right' }}>
                  tp {p.takeProfitPct}
                  <br />
                  sl {p.stopLossPct}
                </div>
                <button
                  className="btn sm danger"
                  onClick={() => api.sellPosition(p.id, 'manual')}
                  disabled={!canSell}
                >
                  sell
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
