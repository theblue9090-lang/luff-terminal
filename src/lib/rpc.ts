// -----------------------------------------------------------------------------
// RPC connection pool.
//
// Reads (on-chain bonding-curve price polls, balances) are round-robined across
// every free RPC with per-attempt timeout + failover. Spreading requests means
// no single endpoint is rate-limited, and failing over past a slow/erroring one
// means the price poll never stalls — eliminating limit- and delay-related PnL
// lag. The first connection (primary) also carries the WebSocket used for
// signature confirmation.
// -----------------------------------------------------------------------------

import { Connection, type AccountInfo, type PublicKey } from '@solana/web3.js'
import { READ_RPCS, wsFromHttp } from '../config'

const connections: Connection[] = READ_RPCS.map(
  (url, i) =>
    new Connection(url, {
      commitment: 'confirmed',
      // Only the primary needs a WS endpoint (confirmSignature subscribes);
      // pool reads are plain HTTP, so we avoid opening extra sockets.
      wsEndpoint: i === 0 ? wsFromHttp(url) : undefined,
    }),
)

/** Primary connection — used for signing context, confirmation, and balances. */
export const primaryConnection: Connection = connections[0]

/** Number of RPCs in the read pool. */
export const readPoolSize = connections.length

let cursor = 0

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('rpc timeout')), ms),
    ),
  ])
}

/**
 * getMultipleAccountsInfo across the pool: start at the round-robin cursor and
 * try each RPC until one answers within `perTryMs`. Returns null only if every
 * RPC failed (caller falls back to another price source).
 */
export async function pooledGetMultipleAccounts(
  pubkeys: PublicKey[],
  commitment: 'processed' | 'confirmed' = 'processed',
  perTryMs = 1800,
): Promise<(AccountInfo<Uint8Array> | null)[] | null> {
  const start = cursor
  cursor = (cursor + 1) % connections.length
  for (let i = 0; i < connections.length; i++) {
    const conn = connections[(start + i) % connections.length]
    try {
      return (await withTimeout(
        conn.getMultipleAccountsInfo(pubkeys, commitment),
        perTryMs,
      )) as (AccountInfo<Uint8Array> | null)[]
    } catch {
      // try the next RPC
    }
  }
  return null
}
