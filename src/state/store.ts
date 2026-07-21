import { create } from 'zustand'
import { DEFAULT_SNIPE, loadConfig, saveConfig, type SnipeConfig } from '../config'
import type {
  FeedStatus,
  LogEntry,
  LogLevel,
  Position,
  TokenEvent,
} from '../types'

const MAX_LOGS = 500
const MAX_FEED = 200

let logSeq = 1

interface SniperState {
  // config
  config: SnipeConfig
  setConfig: (patch: Partial<SnipeConfig>) => void

  // logs
  logs: LogEntry[]
  log: (level: LogLevel, msg: string) => void
  clearLogs: () => void

  // feed of detected tokens
  feed: TokenEvent[]
  pushToken: (t: TokenEvent) => void
  updateToken: (mint: string, patch: Partial<TokenEvent>) => void
  clearFeed: () => void

  // positions
  positions: Position[]
  addPosition: (p: Position) => void
  updatePosition: (id: string, patch: Partial<Position>) => void

  // connection status
  pumpStatus: FeedStatus
  dexStatus: FeedStatus
  setPumpStatus: (s: FeedStatus) => void
  setDexStatus: (s: FeedStatus) => void

  // wallet
  balanceSol: number | null
  setBalance: (b: number | null) => void

  // running flag for the engine
  running: boolean
  setRunning: (r: boolean) => void

  // stats
  detectedCount: number
  snipedCount: number
  incDetected: () => void

  // cumulative SOL committed to buys this session (spend guard)
  sessionSpentSol: number
  addSpend: (delta: number) => void
}

export const useStore = create<SniperState>((set) => ({
  config: loadConfig(DEFAULT_SNIPE),
  setConfig: (patch) =>
    set((s) => {
      const config = { ...s.config, ...patch }
      saveConfig(config)
      return { config }
    }),

  logs: [],
  log: (level, msg) =>
    set((s) => {
      const entry: LogEntry = { id: logSeq++, ts: Date.now(), level, msg }
      const logs = [...s.logs, entry]
      return { logs: logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs }
    }),
  clearLogs: () => set({ logs: [] }),

  feed: [],
  pushToken: (t) =>
    set((s) => {
      if (s.feed.some((x) => x.mint === t.mint)) return s
      const feed = [t, ...s.feed]
      return {
        feed: feed.length > MAX_FEED ? feed.slice(0, MAX_FEED) : feed,
        detectedCount: s.detectedCount + 1,
      }
    }),
  updateToken: (mint, patch) =>
    set((s) => ({
      feed: s.feed.map((t) => (t.mint === mint ? { ...t, ...patch } : t)),
    })),
  clearFeed: () => set({ feed: [] }),

  positions: [],
  addPosition: (p) =>
    set((s) => ({
      positions: [p, ...s.positions],
      snipedCount: s.snipedCount + 1,
    })),
  updatePosition: (id, patch) =>
    set((s) => ({
      positions: s.positions.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    })),

  pumpStatus: 'disconnected',
  dexStatus: 'disconnected',
  setPumpStatus: (s) => set({ pumpStatus: s }),
  setDexStatus: (s) => set({ dexStatus: s }),

  balanceSol: null,
  setBalance: (b) => set({ balanceSol: b }),

  running: false,
  setRunning: (r) => set({ running: r }),

  detectedCount: 0,
  snipedCount: 0,
  incDetected: () => set((s) => ({ detectedCount: s.detectedCount + 1 })),

  sessionSpentSol: 0,
  addSpend: (delta) =>
    set((s) => ({ sessionSpentSol: Math.max(0, s.sessionSpentSol + delta) })),
}))
