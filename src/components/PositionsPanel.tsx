import { useState } from 'react'
import { useStore } from '../state/store'
import { fmtPct, fmtSol, fmtSolSigned, shortAddr } from '../lib/format'
import { positionPnl } from '../lib/pnl'
import type { Position } from '../types'
import type { SniperApi } from '../hooks/useSniper'

function pnlClass(n?: number): string {
  if (n == null || n === 0) return ''
  return n > 0 ? 'pnl-pos' : 'pnl-neg'
}

function priceStr(n?: number): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toExponential(2)
}

function PositionCard({
  p,
  api,
}: {
  p: Position
  api: SniperApi
}) {
  const pnl = positionPnl(p)
  const canSell = p.status === 'open'
  return (
    <div className="pos-card">
      <div className="pos-top">
        <div className="pos-sym">
          {p.symbol || shortAddr(p.mint)}{' '}
          <span className="badge">{p.pool}</span>
        </div>
        <div className={`pnl-big tabular ${pnlClass(pnl.pnlPct)}`}>
          {pnl.pnlPct != null ? fmtPct(pnl.pnlPct) : '—'}
        </div>
      </div>

      <div className="pos-mid">
        <span className="muted">
          {fmtSol(p.investedSol)}◎ → {fmtSol(pnl.valueSol)}◎
        </span>
        <span className={`tabular ${pnlClass(pnl.pnlSol)}`}>
          {pnl.pnlSol != null ? `${fmtSolSigned(pnl.pnlSol)}◎` : '—'}
        </span>
      </div>

      <div className="pos-mid mono-xs muted">
        <span>
          entry {priceStr(p.entryPriceSol)} · now {priceStr(p.lastPriceSol)}
        </span>
      </div>

      <div className="pos-bot">
        <span className={`status-pill status-${p.status}`}>{p.status}</span>
        <span className="muted mono-xs">
          tp {p.takeProfitPct} / sl {p.stopLossPct}
        </span>
        {canSell ? (
          <button
            className="btn sm danger"
            onClick={() => api.sellPosition(p.id, 'manual')}
          >
            sell
          </button>
        ) : (
          <span style={{ width: 1 }} />
        )}
      </div>

      {p.error && (
        <div className="pos-err mono-xs">{p.error.slice(0, 80)}</div>
      )}
    </div>
  )
}

export function PositionsPanel({ api }: { api: SniperApi }) {
  const positions = useStore((s) => s.positions)
  const [tab, setTab] = useState<'open' | 'history'>('open')

  const open = positions.filter(
    (p) => p.status === 'open' || p.status === 'buying' || p.status === 'selling',
  )
  const history = positions.filter(
    (p) => p.status === 'closed' || p.status === 'failed',
  )
  const shown = tab === 'open' ? open : history

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">💼 positions</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            className={`btn sm ${tab === 'open' ? 'primary' : ''}`}
            onClick={() => setTab('open')}
          >
            open {open.length}
          </button>
          <button
            className={`btn sm ${tab === 'history' ? 'primary' : ''}`}
            onClick={() => setTab('history')}
          >
            history {history.length}
          </button>
          <button
            className="btn sm danger"
            onClick={api.closeAll}
            disabled={open.filter((p) => p.status === 'open').length === 0}
            title="sell all open positions"
          >
            close all
          </button>
        </div>
      </div>
      <div className="panel-body pad">
        {shown.length === 0 ? (
          <div className="empty">
            {tab === 'open' ? 'no open positions' : 'no trade history yet'}
          </div>
        ) : (
          shown.map((p) => <PositionCard key={p.id} p={p} api={api} />)
        )}
      </div>
    </div>
  )
}
