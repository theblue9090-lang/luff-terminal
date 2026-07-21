import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Some Solana / wallet deps expect a Node-style global.
    global: 'globalThis',
  },
  resolve: {
    alias: {
      // Browser polyfill for Node's Buffer, required by @solana/web3.js.
      buffer: 'buffer/',
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  server: {
    // Dev-only proxies so the app works locally even if an upstream lacks
    // permissive CORS headers. In production these hosts are called directly
    // (see src/config.ts) or you point the VITE_* env vars at your own proxy.
    proxy: {
      '/pp': {
        target: 'https://pumpportal.fun',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/pp/, ''),
      },
      '/ds': {
        target: 'https://api.dexscreener.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ds/, ''),
      },
    },
  },
})
