import { useState } from 'react'
import { usePrivy, useUser } from '@privy-io/react-auth'
import { useHeadlessDelegatedActions } from '@privy-io/react-auth'
import { useStore } from '../state/store'

/**
 * "Hands-free" trading toggle.
 *
 * Buys/sells already sign silently because the app runs with
 * `showWalletUIs: false` — there is no per-trade popup. Delegating the embedded
 * wallet is the explicit, one-time authorization Privy offers for automated
 * transacting on the user's behalf: authorize once here and the sniper never
 * asks again. Delegation is headless (no Privy modal) and always revocable.
 */
export function HandsFreeToggle() {
  const { user } = usePrivy()
  const { refreshUser } = useUser()
  const { delegateWallet, revokeWallets } = useHeadlessDelegatedActions()
  const log = useStore((s) => s.log)
  const [busy, setBusy] = useState(false)

  const embedded = user?.linkedAccounts?.find(
    (a) =>
      a.type === 'wallet' &&
      a.chainType === 'solana' &&
      (a.walletClientType === 'privy' || a.walletClientType === 'privy-v2'),
  ) as { address?: string; delegated?: boolean } | undefined

  const address = embedded?.address
  const delegated = !!embedded?.delegated

  async function toggle() {
    if (!address || busy) return
    setBusy(true)
    try {
      if (delegated) {
        await revokeWallets()
        log('system', 'hands-free trading DISABLED (delegation revoked)')
      } else {
        await delegateWallet({ address, chainType: 'solana' })
        log('system', 'hands-free trading ENABLED — no confirmation required')
      }
      await refreshUser()
    } catch (e) {
      log('error', `delegation failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className={`btn sm ${delegated ? 'primary' : ''}`}
      onClick={toggle}
      disabled={!address || busy}
      title={
        delegated
          ? 'Wallet delegated — buys/sells run fully hands-free. Click to revoke.'
          : 'Authorize hands-free trading once so no confirmation is ever required.'
      }
    >
      {busy ? '…' : delegated ? '⚡ HANDS-FREE ON' : '⚡ HANDS-FREE OFF'}
    </button>
  )
}
