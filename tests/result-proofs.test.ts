import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keccak256, stringToHex } from 'viem';
import { fighter, world } from '../packages/shared/src/game';
import {
  canonical,
  digest,
  matchKey,
  parseResult,
  winnerIds,
  winnerKey,
  type ResultProof,
} from '../packages/shared/src/results';
import { verifyProof, type AnchorReader } from '../apps/web/src/services/proofs';

process.env.DB_PATH = ':memory:';
const store = await import('../apps/server/src/store');
const { resultProof } = await import('../apps/server/src/result-proof');
const { processOutbox } = await import('../apps/server/src/attestation');
const wallet = '0x1111111111111111111111111111111111111111' as const;
const contract = '0x2222222222222222222222222222222222222222' as const;

beforeEach(async () => {
  await store.db.exec(`DELETE FROM participants; DELETE FROM outbox; DELETE FROM results;
    DELETE FROM profiles; DELETE FROM wallets; DELETE FROM badges;`);
});

async function finishedMatch(demo = false, linked = true) {
  const player = await store.createProfile('Sam', demo),
    w = world('duel', demo);
  if (linked) await store.db.prepare('INSERT INTO wallets VALUES (?,?)').run(player.id, wallet);
  w.players = [fighter(player.id, player.name), fighter('bot-1', 'Practice opponent', 1, true)];
  w.winner = 0;
  w.finished = true;
  await store.recordResult('proof-match', w, new Date().toISOString());
  const proof = (await resultProof('proof-match', player.id))!;
  return { player, w, proof, payload: parseResult(proof.payload) };
}
async function liveProof(): Promise<ResultProof> {
  const { proof } = await finishedMatch();
  return { ...proof, status: 'confirmed', simulated: false, chain: { chainId: 84532, contract } };
}
function readerFor(proof: ResultProof) {
  return vi
    .fn<AnchorReader>()
    .mockResolvedValue([proof.hash, winnerKey(parseResult(proof.payload)), 1700000000n, wallet]);
}

describe('immutable result identity', () => {
  it('snapshots the verified wallet, name and AI identities into a versioned result', async () => {
    const { player, proof, payload } = await finishedMatch();
    expect(payload.version).toBe(3);
    expect(payload.participants[0]).toMatchObject({
      id: player.id,
      name: 'Sam',
      identity: {
        kind: 'wallet',
        address: wallet,
        chainId: 84532,
        accountId: `eip155:84532:${wallet}`,
      },
    });
    expect(payload.participants[1].identity).toEqual({ kind: 'bot' });
    expect(winnerIds(payload)).toEqual([`eip155:84532:${wallet}`]);
    expect(digest(payload)).toBe(proof.hash);
    await store.db.prepare('DELETE FROM wallets WHERE player_id=?').run(player.id);
    expect(await resultProof('proof-match', player.id)).toEqual(proof);
  });

  it('does not retroactively attach a wallet to older guest results', async () => {
    const { player, proof, payload } = await finishedMatch(false, false);
    expect(payload.participants[0].identity).toEqual({ kind: 'profile' });
    await store.db.prepare('INSERT INTO wallets VALUES (?,?)').run(player.id, wallet);
    expect(await resultProof('proof-match', player.id)).toEqual(proof);
    expect(winnerIds(payload)).toEqual([`profile:${player.id}`]);
  });

  it('retains the player wallet when an AI substitutes for a disconnected human', async () => {
    const player = await store.createProfile('Disconnected', false),
      w = world('duel', false);
    await store.db.prepare('INSERT INTO wallets VALUES (?,?)').run(player.id, wallet);
    w.players = [fighter(player.id, player.name, 0, true)];
    w.winner = 0;
    w.finished = true;
    await store.recordResult('substitute', w, new Date().toISOString());
    const payload = parseResult((await resultProof('substitute', player.id))!.payload);
    expect(payload.participants[0]).toMatchObject({ bot: true, identity: { kind: 'wallet' } });
    expect(winnerIds(payload)).toEqual([`eip155:84532:${wallet}`]);
  });

  it('restricts proofs to recorded participants even after squad membership changes', async () => {
    const { proof } = await finishedMatch(),
      stranger = await store.createProfile('Stranger', false);
    expect(await resultProof(proof.matchId, stranger.id)).toBeUndefined();
    expect(await resultProof('missing', stranger.id)).toBeUndefined();
  });

  it('passes frozen winner identities to the outbox and refuses corrupted result data', async () => {
    const { player } = await finishedMatch();
    await store.db.prepare('DELETE FROM wallets WHERE player_id=?').run(player.id);
    await store.db.prepare("UPDATE outbox SET status='pending'").run();
    const submit = vi.fn().mockResolvedValue({ status: 'confirmed' });
    await processOutbox({ submit });
    expect(submit.mock.calls[0][2]).toBe(JSON.stringify([`eip155:84532:${wallet}`]));
    await store.db
      .prepare("UPDATE results SET payload=json_set(payload,'$.scoreline[0]',999)")
      .run();
    await store.db.prepare("UPDATE outbox SET status='pending'").run();
    await processOutbox({ submit });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await store.db.prepare('SELECT status,error FROM outbox').get()).toMatchObject({
      status: 'failed',
      error: 'Stored result hash mismatch',
    });
  });
});

describe('independent result checks', () => {
  it('verifies simulated integrity without contacting a blockchain', async () => {
    const { proof } = await finishedMatch(true),
      read = vi.fn<AnchorReader>();
    expect(await verifyProof(proof, read)).toMatchObject({
      local: { status: 'match' },
      chain: 'simulated',
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('detects a changed score before attempting a blockchain read', async () => {
    const proof = await liveProof(),
      read = readerFor(proof),
      payload = JSON.parse(proof.payload);
    payload.scoreline[0] = 999;
    expect(await verifyProof({ ...proof, payload: JSON.stringify(payload) }, read)).toMatchObject({
      local: { status: 'mismatch' },
      chain: 'not-checked',
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('detects a changed wallet identity in the saved result', async () => {
    const proof = await liveProof(),
      payload = JSON.parse(proof.payload);
    payload.participants[0].identity = { kind: 'profile' };
    expect((await verifyProof({ ...proof, payload: JSON.stringify(payload) })).local.status).toBe(
      'mismatch',
    );
  });

  it('rejects invalid JSON, unsupported versions and an inconsistent account ID', async () => {
    const proof = await liveProof(),
      payload = JSON.parse(proof.payload);
    const invalidVersion = { ...payload, version: 99 };
    payload.participants[0].identity.accountId = 'eip155:1:wrong';
    for (const serialized of ['broken', JSON.stringify(invalidVersion), JSON.stringify(payload)]) {
      expect(await verifyProof({ ...proof, payload: serialized })).toMatchObject({
        local: { status: 'invalid' },
        chain: 'not-checked',
      });
    }
  });

  it('rejects a result belonging to a different match even if its hash matches', async () => {
    const proof = await liveProof();
    expect((await verifyProof({ ...proof, matchId: 'another-match' })).local.status).toBe(
      'mismatch',
    );
  });

  it('verifies both the hash and winners by reading the configured contract', async () => {
    const proof = await liveProof(),
      read = readerFor(proof),
      check = await verifyProof(proof, read);
    expect(read).toHaveBeenCalledWith(contract, matchKey(proof.matchId));
    expect(check).toMatchObject({ local: { status: 'match' }, chain: 'match', attestor: wallet });
    expect(check.recordedAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('does not trust the server confirmed label when the record is missing', async () => {
    const proof = await liveProof(),
      read = readerFor(proof);
    read.mockResolvedValue([proof.hash, winnerKey(parseResult(proof.payload)), 0n, wallet]);
    expect((await verifyProof(proof, read)).chain).toBe('not-found');
  });

  it('rejects either a result-hash mismatch or a winner mismatch on-chain', async () => {
    const proof = await liveProof(),
      read = readerFor(proof),
      wrong = keccak256(stringToHex('wrong'));
    read.mockResolvedValueOnce([wrong, winnerKey(parseResult(proof.payload)), 1700000000n, wallet]);
    read.mockResolvedValueOnce([proof.hash, wrong, 1700000000n, wallet]);
    expect((await verifyProof(proof, read)).chain).toBe('mismatch');
    expect((await verifyProof(proof, read)).chain).toBe('mismatch');
  });

  it('reports a network failure separately from local integrity', async () => {
    const proof = await liveProof(),
      read = readerFor(proof);
    read.mockRejectedValue(Error('RPC unavailable'));
    expect(await verifyProof(proof, read)).toMatchObject({
      local: { status: 'match' },
      chain: 'unavailable',
    });
    expect(await verifyProof({ ...proof, chain: null }, read)).toMatchObject({
      local: { status: 'match' },
      chain: 'unconfigured',
    });
  });

  it('keeps demo results simulated even if their status claims confirmation', async () => {
    const { proof } = await finishedMatch(true),
      read = vi.fn<AnchorReader>();
    expect(
      (
        await verifyProof(
          { ...proof, status: 'confirmed', simulated: false, chain: { chainId: 84532, contract } },
          read,
        )
      ).chain,
    ).toBe('simulated');
    expect(read).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    'supports version %i hashes and their historical winner digests',
    async (version) => {
      const proof = await liveProof(),
        payload = JSON.parse(proof.payload);
      payload.version = version;
      for (const p of payload.participants) {
        delete p.identity;
        delete p.name;
      }
      const legacy = { ...proof, payload: canonical(payload), hash: digest(payload) },
        read = readerFor(legacy);
      expect(winnerKey(parseResult(legacy.payload))).toBe(
        keccak256(stringToHex(JSON.stringify([payload.participants[0].id]))),
      );
      expect((await verifyProof(legacy, read)).chain).toBe('match');
    },
  );
});
