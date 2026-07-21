import { useStore } from '../state/store'
import type { SnipeConfig } from '../config'

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="toggle" onClick={() => onChange(!value)} role="button">
      <span className="lbl">{label}</span>
      <span className={`switch ${value ? 'on' : ''}`} />
    </div>
  )
}

function NumField({
  label,
  k,
  step = 'any',
  min = 0,
}: {
  label: string
  k: keyof SnipeConfig
  step?: string | number
  min?: number
}) {
  const value = useStore((s) => s.config[k]) as number
  const setConfig = useStore((s) => s.setConfig)
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          setConfig({ [k]: Number.isFinite(n) ? n : 0 } as Partial<SnipeConfig>)
        }}
      />
    </div>
  )
}

export function ConfigPanel() {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">⚙ snipe config</span>
      </div>
      <div className="panel-body pad">
        <Toggle
          label="AUTO-SNIPE new tokens"
          value={config.autoSnipe}
          onChange={(v) => setConfig({ autoSnipe: v })}
        />
        <Toggle
          label="AUTO-MANAGE (TP / SL)"
          value={config.autoManage}
          onChange={(v) => setConfig({ autoManage: v })}
        />

        <div className="field-row">
          <NumField label="buy (SOL)" k="buyAmountSol" step="0.01" />
          <NumField label="max positions" k="maxOpenPositions" step="1" />
        </div>

        <div className="field-row">
          <NumField label="slippage %" k="slippage" step="1" />
          <NumField label="priority (SOL)" k="priorityFee" step="0.0001" />
        </div>

        <div className="field-row">
          <NumField label="take profit %" k="takeProfitPct" step="1" />
          <NumField label="stop loss %" k="stopLossPct" step="1" />
        </div>

        <div style={{ margin: '12px 0 6px', color: 'var(--text-faint)', fontSize: 10, letterSpacing: 1 }}>
          — ENTRY FILTERS —
        </div>

        <div className="field-row">
          <NumField label="max dev buy (SOL)" k="maxDevBuySol" step="0.1" />
          <NumField label="min liq (SOL)" k="minLiquiditySol" step="0.1" />
        </div>

        <div className="muted mono-xs" style={{ marginTop: 8, lineHeight: 1.6 }}>
          higher priority fee = faster inclusion but higher cost. filters of 0
          are ignored. dev-buy filter only applies to pump.fun events.
        </div>
      </div>
    </div>
  )
}
