import { usePrivy } from '@privy-io/react-auth'
import { useStore } from '../state/store'
import { fmtSol, shortAddr } from '../lib/format'
import type { FeedStatus } from '../types'
import type { SniperApi } from '../hooks/useSniper'
import { HandsFreeToggle } from './HandsFreeToggle'
import { Logo } from './Logo'

function StatusDot({ status, label }: { status: FeedStatus; label: string }) {
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
      title={`${label}: ${status}`}
    >
      <span className={`dot ${status}`} />
      <span className="muted mono-xs">{label}</span>
    </span>
  )
}

export function Header({ api }: { api: SniperApi }) {
  const { logout } = usePrivy()
  const running = useStore((s) => s.running)
  const balance = useStore((s) => s.balanceSol)
  const pumpStatus = useStore((s) => s.pumpStatus)
  const dexStatus = useStore((s) => s.dexStatus)
  const detected = useStore((s) => s.detectedCount)
  const sniped = useStore((s) => s.snipedCount)

  return (
    <div className="topbar">
      <div className="brand">
        <Logo />
        <span className="tag">solana mainnet</span>
        <span style={{ display: 'flex', gap: 12, marginLeft: 12 }}>
          <StatusDot status={pumpStatus} label="pump.fun" />
          <StatusDot status={dexStatus} label="dexscreener" />
        </span>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="k">detected</span>
          <span className="v tabular">{detected}</span>
        </div>
        <div className="stat">
          <span className="k">sniped</span>
          <span className="v tabular">{sniped}</span>
        </div>
        <div className="stat">
          <span className="k">balance</span>
          <span className="v tabular">
            {balance == null ? '—' : `${fmtSol(balance)} ◎`}
          </span>
        </div>
        <div className="stat">
          <span className="k">wallet</span>
          <span className="v">{shortAddr(api.address)}</span>
        </div>

        <HandsFreeToggle />

        {running ? (
          <button className="btn danger" onClick={api.stop}>
            ■ STOP
          </button>
        ) : (
          <button className="btn primary" onClick={api.start} disabled={!api.ready}>
            ▶ START ENGINE
          </button>
        )}
        <button className="btn sm" onClick={logout} title="log out">
          ⏻
        </button>
      </div>
    </div>
  )
}
