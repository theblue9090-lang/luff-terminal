import { useState, type KeyboardEvent } from 'react'
import { useStore } from '../state/store'
import type { SnipeConfig } from '../config'
import type { SniperApi } from '../hooks/useSniper'

const HELP = [
  'commands:',
  '  buy <mint> [sol]      market buy a token (default: config buy amount)',
  '  sell <mint>           sell full position for a mint',
  '  start | stop          toggle the detection engine',
  '  closeall              sell every open position',
  '  set <key> <value>     e.g. set buyAmountSol 0.1 · set takeProfitPct 80',
  '  auto on|off           toggle auto-snipe',
  '  clear                 clear the console',
  '  help                  show this',
]

const NUMERIC_KEYS: (keyof SnipeConfig)[] = [
  'buyAmountSol',
  'slippage',
  'priorityFee',
  'takeProfitPct',
  'stopLossPct',
  'maxOpenPositions',
  'maxDevBuySol',
  'minMarketCapUsd',
  'maxMarketCapUsd',
  'minLiquidityUsd',
  'maxSpendSol',
]

export function CommandBar({ api }: { api: SniperApi }) {
  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [hIdx, setHIdx] = useState(-1)
  const log = useStore((s) => s.log)

  function run(raw: string) {
    const line = raw.trim()
    if (!line) return
    setHistory((h) => [...h, line])
    setHIdx(-1)
    log('info', `> ${line}`)

    const [cmd, ...args] = line.split(/\s+/)
    const g = useStore.getState()

    switch (cmd.toLowerCase()) {
      case 'help':
        HELP.forEach((l) => log('system', l))
        break
      case 'clear':
        g.clearLogs()
        break
      case 'start':
        api.start()
        break
      case 'stop':
        api.stop()
        break
      case 'closeall':
        api.closeAll()
        break
      case 'buy': {
        if (!args[0]) {
          log('error', 'usage: buy <mint> [sol]')
          break
        }
        const amt = args[1] ? Number(args[1]) : undefined
        api.manualBuy(args[0], Number.isFinite(amt) ? amt : undefined)
        break
      }
      case 'sell': {
        if (!args[0]) {
          log('error', 'usage: sell <mint>')
          break
        }
        const target = args[0]
        const pos = g.positions.find(
          (p) =>
            (p.mint === target || p.id === target) &&
            (p.status === 'open' || p.status === 'buying'),
        )
        if (!pos) {
          log('error', `no open position for ${target}`)
          break
        }
        api.sellPosition(pos.id, 'manual')
        break
      }
      case 'auto': {
        const on = args[0]?.toLowerCase() === 'on'
        g.setConfig({ autoSnipe: on })
        log('system', `auto-snipe ${on ? 'ENABLED' : 'disabled'}`)
        break
      }
      case 'set': {
        const key = args[0] as keyof SnipeConfig
        if (!NUMERIC_KEYS.includes(key)) {
          log('error', `unknown key. numeric keys: ${NUMERIC_KEYS.join(', ')}`)
          break
        }
        const n = Number(args[1])
        if (!Number.isFinite(n)) {
          log('error', `invalid number: ${args[1]}`)
          break
        }
        g.setConfig({ [key]: n } as Partial<SnipeConfig>)
        log('system', `${key} = ${n}`)
        break
      }
      default:
        log('error', `unknown command: ${cmd} (try 'help')`)
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      run(value)
      setValue('')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const idx = hIdx < 0 ? history.length - 1 : Math.max(0, hIdx - 1)
      setHIdx(idx)
      setValue(history[idx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (hIdx < 0) return
      const idx = hIdx + 1
      if (idx >= history.length) {
        setHIdx(-1)
        setValue('')
      } else {
        setHIdx(idx)
        setValue(history[idx])
      }
    }
  }

  return (
    <div className="cmd">
      <span className="prompt glow">luff@solana:~$</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        placeholder="type a command — 'help' for list · e.g. buy <mint> 0.1"
        spellCheck={false}
        autoComplete="off"
      />
      <span className="blink" style={{ color: 'var(--green)' }}>
        ▊
      </span>
    </div>
  )
}
