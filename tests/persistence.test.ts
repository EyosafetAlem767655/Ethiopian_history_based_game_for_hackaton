import { beforeAll, describe, it, expect } from 'vitest';
import { fighter, world } from '../packages/shared/src/game';
process.env.DB_PATH = ':memory:';
const store = await import('../apps/server/src/store');
const { processOutbox } = await import('../apps/server/src/attestation');
describe('trusted records', () => {
  it('attributes a squad result to admitted players and the original team after membership changes', async () => {
    const a = await store.createProfile('Participant', true),
      b = await store.createProfile('Absent teammate', true),
      c = await store.createProfile('New teammate', true);
    await store.db
      .prepare('INSERT INTO squads(id,code,name,demo,members) VALUES (?,?,?,?,?)')
      .run('old-squad', 'OLDTEAM', 'Old team', 1, JSON.stringify([b.id]));
    await store.db
      .prepare('INSERT INTO squads(id,code,name,demo,members) VALUES (?,?,?,?,?)')
      .run('new-squad', 'NEWTEAM', 'New team', 1, JSON.stringify([a.id, c.id]));
    const w = world('squad', true),
      f = fighter(a.id, a.name, 0);
    f.squadId = 'old-squad';
    w.players = [f, fighter('opponent', 'AI', 1, true)];
    w.winner = 0;
    w.finished = true;
    await store.recordResult('roster-snapshot', w, new Date().toISOString());
    expect(
      await store.db.prepare('SELECT wins,rating FROM squads WHERE id=?').get('old-squad'),
    ).toEqual({ wins: 1, rating: 1050 });
    expect(
      await store.db.prepare('SELECT wins,rating FROM squads WHERE id=?').get('new-squad'),
    ).toEqual({ wins: 0, rating: 1000 });
    expect((await store.profile(a.id))!.progress.squadWins).toBe(1);
    expect((await store.profile(b.id))!.progress.squadWins).toBe(0);
    expect((await store.profile(c.id))!.progress.squadWins).toBe(0);
  });
  it('authenticates signed sessions and rejects tampering', async () => {
    const p = await store.createProfile('Tester', true);
    const t = store.token(p);
    expect((await store.authenticate(t)).id).toBe(p.id);
    await expect(store.authenticate(t + 'x')).rejects.toThrow();
  });
  it('hashes canonical payloads independently of key order', () => {
    expect(store.digest({ a: 1, b: 2 })).toBe(store.digest({ b: 2, a: 1 }));
    expect(store.digest({ a: 2 })).not.toBe(store.digest({ a: 1 }));
  });
  it('atomically records result and awards progression once', async () => {
    const p = await store.createProfile('Duelist', true),
      w = world('duel', true);
    w.players = [fighter(p.id, p.name), fighter('bot', 'Bot', 1, true)];
    w.winner = 0;
    w.finished = true;
    expect(await store.recordResult('match-1', w, new Date().toISOString())).toBe(true);
    expect(await store.recordResult('match-1', w, new Date().toISOString())).toBe(false);
    expect((await store.profile(p.id))!.progress.wins).toBe(1);
    expect(await store.history(p.id)).toHaveLength(1);
    expect(await store.badges(p.id)).toHaveLength(1);
  });
  it('retries failed outbox records without duplicate results', async () => {
    const p = await store.createProfile('Live', false),
      w = world('duel', false);
    w.players = [fighter(p.id, p.name)];
    w.winner = 0;
    await store.recordResult('retry-1', w, new Date().toISOString());
    await store.db.prepare('UPDATE outbox SET status=? WHERE match_id=?').run('pending', 'retry-1');
    const { processOutbox } = await import('../apps/server/src/attestation');
    await processOutbox({
      submit: async () => {
        throw Error('RPC unavailable');
      },
    });
    expect(
      ((await store.db.prepare('SELECT status FROM outbox WHERE match_id=?').get('retry-1')) as any)
        .status,
    ).toBe('failed');
    await processOutbox({ submit: async () => ({ status: 'confirmed' }) });
    expect(
      ((await store.db.prepare('SELECT status FROM outbox WHERE match_id=?').get('retry-1')) as any)
        .status,
    ).toBe('confirmed');
    expect(await store.history(p.id)).toHaveLength(1);
  });
});
