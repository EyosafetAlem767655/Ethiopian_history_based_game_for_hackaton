import { beforeAll, describe, it, expect } from 'vitest';
import { fighter, world } from '../packages/shared/src/game';
process.env.DB_PATH = ':memory:';
const store = await import('../apps/server/src/store');
const { processOutbox } = await import('../apps/server/src/attestation');
describe('trusted records', () => {
  it('authenticates signed sessions and rejects tampering', () => {
    const p = store.createProfile('Tester', true);
    const t = store.token(p);
    expect(store.authenticate(t).id).toBe(p.id);
    expect(() => store.authenticate(t + 'x')).toThrow();
  });
  it('hashes canonical payloads independently of key order', () => {
    expect(store.digest({ a: 1, b: 2 })).toBe(store.digest({ b: 2, a: 1 }));
    expect(store.digest({ a: 2 })).not.toBe(store.digest({ a: 1 }));
  });
  it('atomically records result and awards progression once', () => {
    const p = store.createProfile('Duelist', true),
      w = world('duel', true);
    w.players = [fighter(p.id, p.name), fighter('bot', 'Bot', 1, true)];
    w.winner = 0;
    w.finished = true;
    expect(store.recordResult('match-1', w, new Date().toISOString())).toBe(true);
    expect(store.recordResult('match-1', w, new Date().toISOString())).toBe(false);
    expect(store.profile(p.id)!.progress.wins).toBe(1);
    expect(store.history(p.id)).toHaveLength(1);
    expect(store.badges(p.id)).toHaveLength(1);
  });
  it('retries failed outbox records without duplicate results', async () => {
    const p = store.createProfile('Live', false),
      w = world('duel', false);
    w.players = [fighter(p.id, p.name)];
    w.winner = 0;
    store.recordResult('retry-1', w, new Date().toISOString());
    store.db.prepare('UPDATE outbox SET status=? WHERE match_id=?').run('pending', 'retry-1');
    const { processOutbox } = await import('../apps/server/src/attestation');
    await processOutbox({
      submit: async () => {
        throw Error('RPC unavailable');
      },
    });
    expect(
      (store.db.prepare('SELECT status FROM outbox WHERE match_id=?').get('retry-1') as any).status,
    ).toBe('failed');
    await processOutbox({ submit: async () => ({ status: 'confirmed' }) });
    expect(
      (store.db.prepare('SELECT status FROM outbox WHERE match_id=?').get('retry-1') as any).status,
    ).toBe('confirmed');
    expect(store.history(p.id)).toHaveLength(1);
  });
});
