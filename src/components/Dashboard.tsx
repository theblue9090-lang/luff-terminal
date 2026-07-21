import { useStore } from '../state/store'
import { aggregate } from '../lib/pnl'
import { fmtNum2, fmtPct, fmtSol, fmtSolSigned, fmtUsdSigned } from '../lib/format'

function pnlClass(n?: number): string {
  if (n == null || n === 0) return ''
  return n > 0 ? 'pnl-pos' : 'pnl-neg'
}

function Card({
  label,
  value,
  sub,
  cls,
}: {
  label: string
  value: string
  sub?: string
  cls?: string
}) {
  return (
    <div className="dash-card">
      <div className="dash-k">{label}</div>
      <div className={`dash-v tabular ${cls ?? ''}`}>{value}</div>
      {sub && <div className="dash-sub tabular">{sub}</div>}
    </div>
  )
}

export function Dashboard() {
  const positions = useStore((s) => s.positions)
  const spent = useStore((s) => s.sessionSpentSol)
  const solUsd = useStore((s) => s.solUsd)
  const a = aggregate(positions)

  const usd = solUsd != null
  const unrealizedUsd = usd ? a.unrealizedPnl * solUsd : null
  const totalUsd = usd ? a.totalPnl * solUsd : null
  const realizedUsd = usd ? a.realizedPnl * solUsd : null
  // ROI on currently open capital.
  const roi = a.investedOpen > 0 ? (a.unrealizedPnl / a.investedOpen) * 100 : undefined

  const upCls = pnlClass(a.unrealizedPnl)

  return (
    <div className="dash-wrap">
      {/* Prominent unrealized PnL + ROI */}
      <div className="dash-hero">
        <div className="hero-block">
          <div className="hero-k">Unrealized PNL ({usd ? 'USD' : 'SOL'})</div>
          <div className={`hero-val ${upCls}`}>
            {unrealizedUsd != null
              ? fmtNum2(unrealizedUsd)
              : `${fmtSolSigned(a.unrealizedPnl)} ◎`}
          </div>
        </div>
        <div className="hero-sep" />
        <div className="hero-block hero-roi">
          <div className="hero-k">ROI</div>
          <div className={`hero-val ${pnlClass(roi)}`}>
            {roi != null ? fmtPct(roi) : '—'}
          </div>
        </div>
      </div>

      {/* Secondary stats */}
      <div className="dash-stats">
        <Card
          label={`total pnl${usd ? ' ($)' : ''}`}
          value={
            totalUsd != null
              ? fmtUsdSigned(totalUsd)
              : `${fmtSolSigned(a.totalPnl)} ◎`
          }
          cls={pnlClass(a.totalPnl)}
        />
        <Card
          label={`realized${usd ? ' ($)' : ''}`}
          value={
            realizedUsd != null
              ? fmtUsdSigned(realizedUsd)
              : `${fmtSolSigned(a.realizedPnl)} ◎`
          }
          sub={`${a.closedCount} closed`}
          cls={pnlClass(a.realizedPnl)}
        />
        <Card
          label="open value"
          value={`${fmtSol(a.valueOpen)} ◎`}
          sub={`${a.openCount} open · in ${fmtSol(a.investedOpen)}◎`}
        />
        <Card
          label="win rate"
          value={a.winRate != null ? `${a.winRate.toFixed(0)}%` : '—'}
          sub={`${a.wins}W / ${a.losses}L`}
        />
        <Card
          label="best · worst"
          value={a.best != null ? fmtPct(a.best) : '—'}
          sub={a.worst != null ? fmtPct(a.worst) : undefined}
          cls={pnlClass(a.best)}
        />
        <Card
          label="session spent"
          value={`${fmtSol(spent)} ◎`}
          sub={`${a.failedCount} failed`}
        />
      </div>
    </div>
  )
}
