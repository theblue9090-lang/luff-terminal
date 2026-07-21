import type { Buffer as NodeBuffer } from 'buffer'

declare global {
  interface Window {
    Buffer: typeof NodeBuffer
  }
}

export {}
