import { keccak256, stringToHex, type Hex } from 'viem';
import { z } from 'zod';

export const resultChainId = 84532;
export const walletAccountId = (address: string) =>
  `eip155:${resultChainId}:${address.toLowerCase()}`;

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
      .join(',') +
    '}'
  );
}
export const digest = (value: unknown) => keccak256(stringToHex(canonical(value)));
export const matchKey = (id: string) => keccak256(stringToHex(id));
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v as Hex);

const identitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bot') }).strict(),
  z.object({ kind: z.literal('profile') }).strict(),
  z
    .object({
      kind: z.literal('wallet'),
      address,
      chainId: z.literal(resultChainId),
      accountId: z.string(),
    })
    .strict(),
]);
export type ResultIdentity = z.infer<typeof identitySchema>;

const payloadSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    matchId: z.string().min(1),
    mode: z.string().min(1),
    demo: z.boolean(),
    winner: z.number().int(),
    scoreline: z.array(z.number().finite()),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    participants: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().optional(),
          bot: z.boolean(),
          team: z.number().int(),
          identity: identitySchema.optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough()
  .superRefine((payload, ctx) => {
    if (payload.version !== 3) return;
    for (const p of payload.participants) {
      const identity = p.identity;
      if (
        !identity ||
        !p.name ||
        (identity.kind === 'wallet' && identity.accountId !== walletAccountId(identity.address))
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid participant identity snapshot',
        });
    }
  });
export type ResultPayload = z.infer<typeof payloadSchema>;

export function parseResult(serialized: string): ResultPayload {
  const payload: unknown = JSON.parse(serialized);
  // Validate without replacing the original object: every original field is hashed.
  payloadSchema.parse(payload);
  return payload as ResultPayload;
}

export function winnerIds(payload: ResultPayload): string[] {
  return payload.participants
    .filter((p) => p.team === payload.winner)
    .map((p) => {
      if (payload.version < 3) return p.id;
      if (p.identity?.kind === 'wallet') return p.identity.accountId;
      return `${p.identity?.kind === 'bot' ? 'bot' : 'profile'}:${p.id}`;
    })
    .sort();
}
// Historical records used the hash of a JSON array, not the hash of each ID.
export const winnerKey = (payload: ResultPayload) =>
  keccak256(stringToHex(JSON.stringify(winnerIds(payload))));

export const proofSchema = z.object({
  matchId: z.string().min(1),
  payload: z.string(),
  hash,
  status: z.enum(['simulated', 'pending', 'failed', 'confirmed']),
  tx: hash.nullable(),
  simulated: z.boolean(),
  chain: z
    .object({
      chainId: z.literal(resultChainId),
      contract: address.refine((v) => !/^0x0{40}$/i.test(v)),
    })
    .nullable(),
});
export type ResultProof = z.infer<typeof proofSchema>;
export interface LocalVerification {
  status: 'match' | 'mismatch' | 'invalid';
  computedHash?: Hex;
  payload?: ResultPayload;
}
export function verifyPayload(proof: ResultProof): LocalVerification {
  try {
    const payload = parseResult(proof.payload),
      computedHash = digest(payload);
    return {
      status:
        payload.matchId === proof.matchId && computedHash.toLowerCase() === proof.hash.toLowerCase()
          ? 'match'
          : 'mismatch',
      computedHash,
      payload,
    };
  } catch {
    return { status: 'invalid' };
  }
}

export const recordsAbi = [
  {
    type: 'function',
    name: 'attest',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'bytes32' },
      { name: 'resultHash', type: 'bytes32' },
      { name: 'winner', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'records',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [
      { name: 'resultHash', type: 'bytes32' },
      { name: 'winner', type: 'bytes32' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'attestor', type: 'address' },
    ],
  },
] as const;
