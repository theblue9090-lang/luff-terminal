import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import { PrivyProvider } from '@privy-io/react-auth'
import { PRIVY_APP_ID, SOLANA_CLUSTERS } from './config'
import App from './App.tsx'
import './index.css'

// @solana/web3.js and friends expect a global Buffer in the browser.
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#22e07a',
          walletChainType: 'solana-only',
        },
        loginMethods: ['email', 'wallet', 'google', 'twitter'],
        embeddedWallets: {
          // Silently create a Solana wallet for every user, and skip the
          // confirmation modal on each signature — required for fast sniping.
          solana: { createOnLogin: 'all-users' },
          showWalletUIs: false,
        },
        solanaClusters: SOLANA_CLUSTERS,
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
)
