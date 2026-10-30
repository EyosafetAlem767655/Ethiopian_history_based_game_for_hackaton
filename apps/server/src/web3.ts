import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { getAddress, isAddress, verifyTypedData, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { db, profile, type Profile } from './store';
import { isHosted } from './hosted';
import { eligibility } from './customization';
import { badgeTokenId, profileKey, registrationData } from '../../../packages/shared/src/web3';
import {
  digest,
  parseResult,
  winnerKey,
  resultChainId,
} from '../../../packages/shared/src/results';

await db.exec(`CREATE TABLE IF NOT EXISTS web3_challenges(player_id TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS web3_jobs(id TEXT PRIMARY KEY,player_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,tx TEXT,error TEXT,created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS web3_player ON web3_jobs(player_id,created);
CREATE INDEX IF NOT EXISTS web3_pending ON web3_jobs(status,next_attempt);`);

export interface ProfileRegistration {
  contract: Address;
  owner: Address;
  profileHash: Hex;
  deadline: number;
  nonce: Hex;
  signature?: Hex;
}
export interface BadgeClaim {
  contract: Address | null;
  owner: Address;
  profileHash: Hex;
  badge: string;
  tokenId: number;
  matchId: string;
  resultHash: Hex;
  winner: Hex;
}
export interface Web3Job {
  id: string;
  player_id: string;
  kind: 'profile' | 'badge';
  payload: string;
  status: string;
  attempts: number;
  tx: Hex | null;
  lease_until: number;
}
export interface Web3Adapter {
  execute(job: Web3Job, saveTransaction: (hash: Hex) => Promise<void>): Promise<void>;
}
export class Web3Error extends Error {
  status = 400;
}
export class RevertedWeb3Transaction extends Web3Error {
  clearTransaction = true;
}
export function web3Contract(): Address | null {
  if (process.env.ALLOW_CHAIN_BROADCAST !== 'true') return null;
  const address = process.env.RECORDS_ADDRESS;
  if (!address || !isAddress(address) || /^0x0{40}$/i.test(address))
    throw new Web3Error('Configure the official RoyalRecords contract before live Web3');
  return getAddress(address);
}
async function linked(p: Profile, live = false) {
  const row = await db.prepare('SELECT address FROM wallets WHERE player_id=?').get(p.id);
  if (!row || !isAddress(row.address)) throw new Web3Error('Link and verify your wallet first');
  if (live && (p.demo || !(await isHosted(p.id)) || !(await eligibility(p.id)).band))
    throw new Web3Error(
      'Live registration and rewards require an eligible signed-in account, not a demo profile',
    );
  return getAddress(row.address);
}
const profileJobId = (id: string, contract: Address | null) =>
  'profile:' + id + ':' + (contract?.toLowerCase() ?? 'simulation');
async function putJob(
  id: string,
  p: Profile,
  kind: Web3Job['kind'],
  payload: unknown,
  live: boolean,
) {
  const existing = await db.prepare('SELECT * FROM web3_jobs WHERE id=?').get(id);
  if (existing && ['confirmed', 'pending', 'processing'].includes(existing.status)) return existing;
  if (
    existing?.status === 'failed' &&
    existing.tx &&
    existing.payload === JSON.stringify(payload)
  ) {
    // Preserve a submitted transaction across retries: a delayed receipt is not
    // permission to spend gas on another transaction.
    await db
      .prepare(
        "UPDATE web3_jobs SET status='pending',attempts=0,next_attempt=0,lease_until=0,error=NULL WHERE id=?",
      )
      .run(id);
    return db.prepare('SELECT * FROM web3_jobs WHERE id=?').get(id);
  }
  await db
    .prepare(
      `INSERT INTO web3_jobs(id,player_id,kind,payload,status,created) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status=excluded.status,attempts=0,next_attempt=0,lease_until=0,tx=NULL,error=NULL`,
    )
    .run(id, p.id, kind, JSON.stringify(payload), live ? 'pending' : 'simulated', Date.now());
  return db.prepare('SELECT * FROM web3_jobs WHERE id=?').get(id);
}
function publicJob(row: any) {
  if (!row) return null;
  const payload = JSON.parse(row.payload);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    attempts: Number(row.attempts),
    tx: row.tx,
    error: row.error,
    contract: payload.contract,
    ...(row.kind === 'badge' ? { badge: payload.badge, tokenId: payload.tokenId } : {}),
  };
}
export async function web3Inventory(playerId: string) {
  const rows = await db
    .prepare('SELECT * FROM web3_jobs WHERE player_id=? ORDER BY created')
    .all(playerId);
  return {
    mode: web3Contract() ? 'testnet' : 'simulated',
    chainId: resultChainId,
    profileHash: profileKey(playerId),
    jobs: rows
      .map(publicJob)
      .filter((job) => job?.contract?.toLowerCase() === web3Contract()?.toLowerCase()),
  };
}
export async function registrationChallenge(p: Profile) {
  const contract = web3Contract();
  if (!contract) return { mode: 'simulated' as const };
  const owner = await linked(p, true);
  const data: ProfileRegistration = {
    contract,
    owner,
    profileHash: profileKey(p.id),
    deadline: Math.floor(Date.now() / 1000) + 600,
    nonce: ('0x' + randomBytes(32).toString('hex')) as Hex,
  };
  await db
    .prepare(
      'INSERT INTO web3_challenges VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET data=excluded.data,expires=excluded.expires',
    )
    .run(p.id, JSON.stringify(data), data.deadline * 1000);
  return { mode: 'testnet' as const, chainId: resultChainId, ...data };
}
export async function queueRegistration(p: Profile, signature?: Hex) {
  const contract = web3Contract(),
    owner = await linked(p, !!contract);
  if (!contract)
    return db.transaction(async () =>
      publicJob(
        await putJob(
          profileJobId(p.id, contract),
          p,
          'profile',
          { owner, contract: null, profileHash: profileKey(p.id) },
          false,
        ),
      ),
    )();
  const challenge = await db.prepare('SELECT * FROM web3_challenges WHERE player_id=?').get(p.id);
  if (!challenge || Number(challenge.expires) <= Date.now() || !signature)
    throw new Web3Error('Request and sign a fresh profile registration');
  const data: ProfileRegistration = JSON.parse(challenge.data);
  if (
    data.contract !== contract ||
    data.owner !== owner ||
    data.profileHash !== profileKey(p.id) ||
    !(await verifyTypedData({
      ...registrationData(contract, owner, data.profileHash, data.deadline, data.nonce),
      address: owner,
      signature,
    }))
  )
    throw new Web3Error('Registration signature does not authorize this profile');
  return db.transaction(async () => {
    if ((await linked(p, true)) !== owner) throw new Web3Error('Wallet changed');
    const consumed = await db
      .prepare('DELETE FROM web3_challenges WHERE player_id=? AND data=? AND expires>?')
      .run(p.id, challenge.data, Date.now());
    if (consumed.changes !== 1) throw new Web3Error('Registration challenge expired or was used');
    return publicJob(
      await putJob(profileJobId(p.id, contract), p, 'profile', { ...data, signature }, true),
    );
  })();
}
async function earnedClaim(p: Profile, badge: string): Promise<BadgeClaim> {
  const contract = web3Contract(),
    owner = await linked(p, !!contract),
    tokenId = badgeTokenId(badge);
  if (!tokenId) throw new Web3Error('Unknown achievement');
  const row = await db
    .prepare(
      `SELECT r.*,o.status AS anchor_status FROM badges b JOIN results r ON r.id=b.match_id
    JOIN participants part ON part.match_id=r.id AND part.player_id=b.player_id JOIN outbox o ON o.match_id=r.id WHERE b.player_id=? AND b.badge=?`,
    )
    .get(p.id, badge);
  if (!row)
    throw new Web3Error(
      'Earn this achievement in a recorded match first. Gathering-only badges are not eligible for minting.',
    );
  const result = parseResult(row.payload);
  if (digest(result) !== row.hash || result.matchId !== row.id)
    throw new Web3Error('Achievement source failed its integrity check');
  if (contract && (row.demo || result.demo || row.anchor_status !== 'confirmed'))
    throw new Web3Error('A confirmed non-demo result is required for a testnet badge');
  const registration = await db
    .prepare('SELECT status,payload FROM web3_jobs WHERE id=?')
    .get(profileJobId(p.id, contract));
  if (
    !registration ||
    (contract
      ? registration.status !== 'confirmed'
      : !['simulated', 'confirmed'].includes(registration.status))
  )
    throw new Web3Error('Register this profile before claiming a badge');
  if (JSON.parse(registration.payload).owner.toLowerCase() !== owner.toLowerCase())
    throw new Web3Error('Registered wallet does not match');
  return {
    contract,
    owner,
    profileHash: profileKey(p.id),
    tokenId,
    badge,
    matchId: row.id,
    resultHash: row.hash,
    winner: winnerKey(result),
  };
}
export async function queueBadge(p: Profile, badge: string) {
  return db.transaction(async () => {
    const claim = await earnedClaim(p, badge);
    return publicJob(
      await putJob(
        'badge:' +
          p.id +
          ':' +
          claim.tokenId +
          ':' +
          (claim.contract?.toLowerCase() ?? 'simulation'),
        p,
        'badge',
        claim,
        !!claim.contract,
      ),
    );
  })();
}
export function registerWeb3Routes(app: Express) {
  app.get('/api/web3', async (_q, r) => r.json(await web3Inventory(r.locals.player.id)));
  app.post('/api/web3/profile/challenge', async (_q, r) =>
    r.json(await registrationChallenge(r.locals.player)),
  );
  app.post('/api/web3/profile/register', async (q, r) => {
    const { signature } = z
      .object({
        signature: z
          .string()
          .regex(/^0x[0-9a-fA-F]{130}$/)
          .optional(),
      })
      .strict()
      .parse(q.body);
    r.json(await queueRegistration(r.locals.player, signature as Hex | undefined));
  });
  app.post('/api/web3/badges', async (q, r) => {
    const { badge } = z
      .object({ badge: z.string().min(1).max(80) })
      .strict()
      .parse(q.body);
    r.json(await queueBadge(r.locals.player, badge));
  });
  app.post('/api/web3/jobs/:id/retry', async (q, r) => {
    const row = await db
      .prepare('SELECT * FROM web3_jobs WHERE id=? AND player_id=?')
      .get(q.params.id, r.locals.player.id);
    if (!row) {
      r.status(404).json({ error: 'Job not found' });
      return;
    }
    if (row.status !== 'failed') {
      r.status(409).json({ error: 'Only failed jobs can be retried' });
      return;
    }
    if (row.kind === 'profile') {
      r.status(409).json({ error: 'Sign a fresh profile registration to retry' });
      return;
    }
    r.json(await queueBadge(r.locals.player, JSON.parse(row.payload).badge));
  });
}
let running = false;
export async function processWeb3Jobs(adapter: Web3Adapter) {
  if (running || !web3Contract()) return;
  running = true;
  try {
    for (let n = 0; n < 3; n++) {
      const job = await db.transaction(async () => {
        const now = Date.now();
        const row = await db
          .prepare(
            `SELECT * FROM web3_jobs WHERE attempts<5 AND next_attempt<=? AND
          (status IN ('pending','failed') OR (status='processing' AND lease_until<?)) ORDER BY created LIMIT 1`,
          )
          .get(now, now);
        if (!row) return undefined;
        const lease = now + 120000;
        await db
          .prepare(
            "UPDATE web3_jobs SET status='processing',attempts=attempts+1,lease_until=? WHERE id=?",
          )
          .run(lease, row.id);
        return { ...row, attempts: Number(row.attempts) + 1, lease_until: lease } as Web3Job;
      })();
      if (!job) break;
      try {
        const p = await profile(job.player_id);
        if (!p) throw new Web3Error('Profile no longer exists');
        const payload = JSON.parse(job.payload);
        if (
          payload.contract !== web3Contract() ||
          payload.owner.toLowerCase() !== (await linked(p, true)).toLowerCase() ||
          payload.profileHash !== profileKey(p.id)
        )
          throw new Web3Error('Web3 job no longer matches this deployment and player');
        if (job.kind === 'badge') {
          const current = await earnedClaim(p, payload.badge);
          if (JSON.stringify(current) !== job.payload)
            throw new Web3Error('Achievement source changed');
        }
        await adapter.execute(job, async (hash) => {
          const updated = await db
            .prepare(
              "UPDATE web3_jobs SET tx=? WHERE id=? AND status='processing' AND lease_until=?",
            )
            .run(hash, job.id, job.lease_until);
          if (!updated.changes) throw new Web3Error('Web3 worker lease expired');
        });
        await db
          .prepare(
            "UPDATE web3_jobs SET status='confirmed',error=NULL,lease_until=0 WHERE id=? AND lease_until=?",
          )
          .run(job.id, job.lease_until);
      } catch (e) {
        await db
          .prepare(
            "UPDATE web3_jobs SET status='failed',error=?,next_attempt=?,lease_until=0,tx=CASE WHEN ?=1 THEN NULL ELSE tx END WHERE id=? AND lease_until=?",
          )
          .run(
            e instanceof Web3Error
              ? e.message
              : 'Blockchain operation failed. Check its transaction and retry.',
            Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
            Number(e instanceof RevertedWeb3Transaction),
            job.id,
            job.lease_until,
          );
      }
    }
  } finally {
    running = false;
  }
}
