import { createPublicClient, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  matchKey,
  proofSchema,
  recordsAbi,
  verifyPayload,
  winnerKey,
  type LocalVerification,
  type ResultProof,
} from '../../../../packages/shared/src/results';

export type Anchor = readonly [Hex, Hex, bigint, Address];
export type AnchorReader = (contract: Address, key: Hex) => Promise<Anchor>;
export interface ProofVerification {
  local: LocalVerification;
  chain:
    | 'not-checked'
    | 'simulated'
    | 'unconfigured'
    | 'not-found'
    | 'match'
    | 'mismatch'
    | 'unavailable';
  recordedAt?: string;
  attestor?: Address;
}

export const readBaseAnchor: AnchorReader = (contract, key) =>
  createPublicClient({
    chain: baseSepolia,
    // A public, fixed network endpoint: no server signing key or private RPC URL.
    transport: http('https://sepolia.base.org', { timeout: 8000, retryCount: 0 }),
  }).readContract({ address: contract, abi: recordsAbi, functionName: 'records', args: [key] });

export async function verifyProof(
  data: unknown,
  readAnchor: AnchorReader = readBaseAnchor,
): Promise<ProofVerification> {
  const validated = proofSchema.safeParse(data);
  if (!validated.success) return { local: { status: 'invalid' }, chain: 'not-checked' };
  const proof: ResultProof = validated.data,
    local = verifyPayload(proof);
  if (local.status !== 'match') return { local, chain: 'not-checked' };
  if (proof.simulated || proof.status === 'simulated' || local.payload!.demo)
    return { local, chain: 'simulated' };
  if (!proof.chain) return { local, chain: 'unconfigured' };
  try {
    // The database's "confirmed" label is not used as evidence. Read the contract.
    const [resultHash, winner, timestamp, attestor] = await readAnchor(
      proof.chain.contract as Address,
      matchKey(proof.matchId),
    );
    if (timestamp === 0n) return { local, chain: 'not-found' };
    return {
      local,
      chain:
        resultHash.toLowerCase() === local.computedHash!.toLowerCase() &&
        winner.toLowerCase() === winnerKey(local.payload!).toLowerCase()
          ? 'match'
          : 'mismatch',
      recordedAt: new Date(Number(timestamp) * 1000).toISOString(),
      attestor,
    };
  } catch {
    return { local, chain: 'unavailable' };
  }
}
