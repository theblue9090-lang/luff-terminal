import { useEffect, useRef, useState } from 'react'
import { usePrivy, useUser } from '@privy-io/react-auth'
import { useHeadlessDelegatedActions } from '@privy-io/react-auth'
import { useStore } from '../state/store'

const PREF_KEY = 'luff.handsfree'
// Default ON: the sniper should auto-buy with no confirmation out of the box.
function autoAllowed(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0'
  } catch {
    return true
  }
}
function setAutoPref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/**
 * "Hands-free" trading control.
 *
 * Buys/sells already sign silently (the app runs with `showWalletUIs: false`,
 * so there is no per-trade popup). On top of that, this AUTO-DELEGATES the
 * embedded wallet the moment it's ready — so auto-snipe executes with zero
 * confirmation, no clicking required. The toggle lets you revoke; a manual
 * revoke is remembered so it won't silently re-enable.
 */
export function HandsFreeToggle() {
  const { user } = usePrivy()
  const { refreshUser } = useUser()
  const { delegateWallet, revokeWallets } = useHeadlessDelegatedActions()
  const log = useStore((s) => s.log)
  const [busy, setBusy] = useState(false)
  const autoTried = useRef(false)

  const embedded = user?.linkedAccounts?.find(
    (a) =>
      a.type === 'wallet' &&
      a.chainType === 'solana' &&
      (a.walletClientType === 'privy' || a.walletClientType === 'privy-v2'),
  ) as { address?: string; delegated?: boolean } | undefined

  const address = embedded?.address
  const delegated = !!embedded?.delegated

  // Auto-enable hands-free once the embedded wallet exists (unless the user
  // has explicitly revoked before). Signing is already silent regardless; this
  // grants the one-time delegation so nothing ever prompts.
  useEffect(() => {
    if (!address || delegated || autoTried.current) return
    if (!autoAllowed()) return
    autoTried.current = true
    ;(async () => {
      try {
        await delegateWallet({ address, chainType: 'solana' })
        await refreshUser()
        log('system', 'hands-free auto-enabled — buys execute with no confirmation')
      } catch {
        // showWalletUIs:false already gives no-modal signing, so this is
        // best-effort; don't surface a scary error.
      }
    })()
  }, [address, delegated, delegateWallet, refreshUser, log])

  async function toggle() {
    if (!address || busy) return
    setBusy(true)
    try {
      if (delegated) {
        await revokeWallets()
        setAutoPref(false)
        log('system', 'hands-free trading DISABLED (delegation revoked)')
      } else {
        await delegateWallet({ address, chainType: 'solana' })
        setAutoPref(true)
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
          : 'Authorize hands-free trading so no confirmation is ever required.'
      }
    >
      {busy ? '…' : delegated ? '⚡ HANDS-FREE ON' : '⚡ HANDS-FREE OFF'}
    </button>
  )
}
