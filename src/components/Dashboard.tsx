import { useStore } from '../state/store'
import { aggregate } from '../lib/pnl'
import { fmtPct, fmtSol, fmtSolSigned } from '../lib/format'

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
  const a = aggregate(positions)

  const totalPctBase = a.investedOpen + spent
  const totalPct =
    totalPctBase > 0 ? (a.totalPnl / totalPctBase) * 100 : undefined

  return (
    <div className="dash">
      <Card
        label="total pnl"
        value={`${fmtSolSigned(a.totalPnl)} ◎`}
        sub={totalPct != null ? fmtPct(totalPct) : undefined}
        cls={pnlClass(a.totalPnl)}
      />
      <Card
        label="realized"
        value={`${fmtSolSigned(a.realizedPnl)} ◎`}
        sub={`${a.closedCount} closed`}
        cls={pnlClass(a.realizedPnl)}
      />
      <Card
        label="unrealized"
        value={`${fmtSolSigned(a.unrealizedPnl)} ◎`}
        sub={`${a.openCount} open`}
        cls={pnlClass(a.unrealizedPnl)}
      />
      <Card
        label="open value"
        value={`${fmtSol(a.valueOpen)} ◎`}
        sub={`in ${fmtSol(a.investedOpen)} ◎`}
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
  )
}
