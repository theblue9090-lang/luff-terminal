import { usePrivy } from '@privy-io/react-auth'
import { LoginGate } from './components/LoginGate'
import { Terminal } from './components/Terminal'
import './App.css'

function App() {
  const { ready, authenticated } = usePrivy()

  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="muted glow">initializing sniper…</div>
      </div>
    )
  }

  return authenticated ? <Terminal /> : <LoginGate />
}

export default App
