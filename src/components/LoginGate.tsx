import { usePrivy } from '@privy-io/react-auth'

export function LoginGate() {
  const { ready, login } = usePrivy()

  return (
    <div className="login-wrap">
      <div className="login-box">
        <h1 className="glow">LUFF·SNIPER</h1>
        <div className="sub">solana new-coin sniper terminal · mainnet</div>

        <div className="line">
          <span className="muted">&gt;</span> targets{' '}
          <span style={{ color: 'var(--green)' }}>pump.fun</span> +{' '}
          <span style={{ color: 'var(--cyan)' }}>dexscreener</span> new listings
        </div>
        <div className="line">
          <span className="muted">&gt;</span> real-time WebSocket detection · self-signed txs
        </div>
        <div className="line">
          <span className="muted">&gt;</span> auto take-profit / stop-loss
        </div>

        <div className="warn">
          ⚠ REAL FUNDS · MAINNET. Sniping brand-new tokens is extremely high
          risk — most new tokens go to zero, and rugs/honeypots are common. Only
          fund the embedded wallet with SOL you can afford to lose. This is not
          financial advice.
        </div>

        <button
          className="btn primary"
          style={{ width: '100%', padding: '10px' }}
          disabled={!ready}
          onClick={login}
        >
          {ready ? '▶ CONNECT WITH PRIVY' : 'initializing…'}
        </button>
      </div>
    </div>
  )
}
