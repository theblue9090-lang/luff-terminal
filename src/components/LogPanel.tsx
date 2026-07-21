import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import { fmtTime } from '../lib/format'

export function LogPanel() {
  const logs = useStore((s) => s.logs)
  const clearLogs = useStore((s) => s.clearLogs)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  // Auto-scroll to the newest line, but only if the user is already at bottom.
  useEffect(() => {
    const el = bodyRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [logs])

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="title">▮ console</span>
        <button className="btn sm" onClick={clearLogs}>
          clear
        </button>
      </div>
      <div
        className="panel-body"
        ref={bodyRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {logs.length === 0 ? (
          <div className="empty">console ready</div>
        ) : (
          logs.map((l) => (
            <div className={`log-line log-${l.level}`} key={l.id}>
              <span className="t">{fmtTime(l.ts)}</span>
              <span>{l.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
