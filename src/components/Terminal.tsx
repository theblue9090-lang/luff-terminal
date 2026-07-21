import { useSniper } from '../hooks/useSniper'
import { Header } from './Header'
import { ConfigPanel } from './ConfigPanel'
import { FeedPanel } from './FeedPanel'
import { PositionsPanel } from './PositionsPanel'
import { LogPanel } from './LogPanel'
import { CommandBar } from './CommandBar'

export function Terminal() {
  const api = useSniper()

  return (
    <div className="app">
      <Header api={api} />
      <div className="grid">
        <div className="col">
          <ConfigPanel />
        </div>
        <div className="center-col">
          <FeedPanel api={api} />
          <LogPanel />
        </div>
        <div className="col">
          <PositionsPanel api={api} />
        </div>
      </div>
      <CommandBar api={api} />
    </div>
  )
}
