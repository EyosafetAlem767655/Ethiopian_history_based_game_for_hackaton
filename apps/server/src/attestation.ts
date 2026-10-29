import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { db } from './store';
import {
  digest,
  matchKey,
  parseResult,
  recordsAbi,
  winnerIds,
} from '../../../packages/shared/src/results';
export { recordsAbi } from '../../../packages/shared/src/results';
export interface AttestationAdapter {
  submit(
    matchId: string,
    resultHash: `0x${string}`,
    winner: string,
  ): Promise<{ status: 'confirmed' | 'simulated'; tx?: string }>;
}
export class SimulatedAttestation implements AttestationAdapter {
  async submit() {
    return { status: 'simulated' as const };
  }
}
export class BaseAttestation implements AttestationAdapter {
  private key;
  private address: Address;
  private rpc;
  constructor() {
    if (process.env.ALLOW_CHAIN_BROADCAST !== 'true')
      throw Error('Live chain broadcasting is not authorized');
    this.key = privateKeyToAccount(process.env.ATTESTOR_PRIVATE_KEY as `0x${string}`);
    this.address = process.env.RECORDS_ADDRESS as Address;
    this.rpc = http(process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org');
  }
  async submit(id: string, hash: `0x${string}`, winner: string) {
    const client = createPublicClient({ chain: baseSepolia, transport: this.rpc });
    const wallet = createWalletClient({
      account: this.key,
      chain: baseSepolia,
      transport: this.rpc,
    });
    const key = matchKey(id),
      winnerHash = keccak256(stringToHex(winner));
    const existing = await client.readContract({
      address: this.address,
      abi: recordsAbi,
      functionName: 'records',
      args: [key],
    });
    if (existing[2] > 0n) {
      if (existing[0] !== hash || existing[1] !== winnerHash)
        throw Error('On-chain result conflict');
      return { status: 'confirmed' as const };
    }
    const tx = await wallet.writeContract({
      address: this.address,
      abi: recordsAbi,
      functionName: 'attest',
      args: [key, hash, winnerHash],
    });
    db.prepare('UPDATE outbox SET tx=? WHERE match_id=?').run(tx, id);
    const receipt = await client.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== 'success') throw Error('Transaction reverted');
    return { status: 'confirmed' as const, tx };
  }
}
let running = false;
export async function processOutbox(adapter: AttestationAdapter) {
  if (running) return;
  running = true;
  try {
    const rows = db
      .prepare(
        `SELECT o.*,r.hash,r.payload,r.demo FROM outbox o JOIN results r ON r.id=o.match_id WHERE o.status IN ('pending','failed') AND o.attempts<5`,
      )
      .all() as any[];
    for (const row of rows) {
      if (row.demo) {
        db.prepare('UPDATE outbox SET status=? WHERE match_id=?').run('simulated', row.match_id);
        continue;
      }
      try {
        db.prepare('UPDATE outbox SET attempts=attempts+1,status=? WHERE match_id=?').run(
          'pending',
          row.match_id,
        );
        const payload = parseResult(row.payload);
        if (payload.matchId !== row.match_id || digest(payload) !== row.hash)
          throw Error('Stored result hash mismatch');
        const out = await adapter.submit(
          row.match_id,
          row.hash,
          JSON.stringify(winnerIds(payload)),
        );
        db.prepare('UPDATE outbox SET status=?,tx=COALESCE(?,tx),error=NULL WHERE match_id=?').run(
          out.status,
          out.tx ?? null,
          row.match_id,
        );
      } catch (e) {
        db.prepare('UPDATE outbox SET status=?,error=? WHERE match_id=?').run(
          'failed',
          (e as Error).message,
          row.match_id,
        );
      }
    }
  } finally {
    running = false;
  }
}
