// -----------------------------------------------------------------------------
// On-chain pump.fun bonding-curve price reader.
//
// This is the lowest-latency, key-free price source for pump.fun tokens: the
// bonding-curve account exists the instant a token is created, so there is NO
// indexing delay (unlike DexScreener) and the price reflects the current
// on-chain reserves. We read it directly over RPC via getMultipleAccountsInfo
// (one call for all held mints).
// -----------------------------------------------------------------------------

import { PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { pooledGetMultipleAccounts } from './rpc'

/** pump.fun program id. */
const PUMP_PROGRAM = new PublicKey(
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
)

/** pump.fun tokens use 6 decimals; SOL uses 9. */
const TOKEN_DECIMALS = 6
const SOL_DECIMALS = 9

/** Derive the bonding-curve PDA for a mint. */
function bondingCurvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_PROGRAM,
  )[0]
}

/**
 * Fetch current SOL-per-token prices for pump.fun mints from their bonding
 * curves. Returns a map of mint -> priceSol. Mints whose curve is missing or
 * has migrated (`complete = true`) are omitted so the caller can fall back to
 * DexScreener.
 */
export async function fetchBondingCurvePrices(
  mints: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (mints.length === 0) return out

  const entries: { mint: string; pda: PublicKey }[] = []
  for (const m of mints) {
    try {
      entries.push({ mint: m, pda: bondingCurvePda(new PublicKey(m)) })
    } catch {
      /* invalid mint string — skip */
    }
  }
  if (entries.length === 0) return out

  // getMultipleAccountsInfo caps at 100 accounts per call; chunk defensively.
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    // Round-robined across all free RPCs with failover (see lib/rpc.ts).
    const infos = await pooledGetMultipleAccounts(
      chunk.map((e) => e.pda),
      'processed',
    )
    if (!infos) continue
    for (let j = 0; j < chunk.length; j++) {
      const info = infos[j]
      if (!info || !info.data) continue
      const data = info.data as Uint8Array
      if (data.length < 48) continue
      try {
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
        // layout: [8]discriminator, u64 vTokenReserves, u64 vSolReserves, ...
        const vTokens = dv.getBigUint64(8, true)
        const vSol = dv.getBigUint64(16, true)
        const complete = data.length > 48 ? data[48] !== 0 : false
        if (complete || vTokens === 0n) continue
        // price per whole token in SOL
        const priceSol =
          Number(vSol) /
          10 ** SOL_DECIMALS /
          (Number(vTokens) / 10 ** TOKEN_DECIMALS)
        if (Number.isFinite(priceSol) && priceSol > 0) {
          out.set(chunk[j].mint, priceSol)
        }
      } catch {
        /* decode error — skip this account */
      }
    }
  }
  return out
}
