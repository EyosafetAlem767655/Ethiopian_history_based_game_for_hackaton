import { expect, it } from 'vitest';
process.env.DB_PATH = ':memory:';
const store = await import('../apps/server/src/store');
const { leaderboard } = await import('../apps/server/src/leaderboard');
it('queries real SQLite $.rating and tolerates missing, invalid and null legacy JSON', () => {
  for (const [name, json] of [
    ['High', '{"rating":1700}'],
    ['Legacy', '{}'],
    ['Corrupt', 'broken'],
    ['Null', 'null'],
    ['Missing rating','{"rating":null}'],
    ['Obsolete rating','{"rating":"legacy"}'],
  ]) {
    const p = store.createProfile(name, false);
    store.db.prepare('UPDATE profiles SET progress=? WHERE id=?').run(json, p.id);
  }
  const rows = leaderboard(0);
  expect(rows[0].name).toBe('High');
  expect(rows).toHaveLength(6);
  expect(rows.every((p) => Number.isFinite(p.progress.rating))).toBe(true);
  expect(leaderboard(1)).toEqual([]);
});
it('atomically saves campaign first clears without altering duel statistics', async () => {
  const { campaignWorld, equipCampaign } = await import('../packages/shared/src/campaign');
  const { fighter } = await import('../packages/shared/src/game');
  const p = store.createProfile('Campaign', true),
    w = campaignWorld(1, true);
  w.players = [equipCampaign(fighter(p.id, p.name), w)];
  w.players[0].honor = 20;
  w.winner = 0;
  w.finished = true;
  expect(store.recordResult('campaign-first', w, new Date().toISOString())).toBe(true);
  const first = store.profile(p.id)!;
  expect(first.progress.wins).toBe(0);
  expect(first.progress.rating).toBe(1000);
  expect(store.campaignProgress(p.id).completed).toEqual([1]);
  expect(store.recordResult('campaign-first', w, new Date().toISOString())).toBe(false);
  store.recordResult('campaign-replay', w, new Date().toISOString());
  expect(store.profile(p.id)!.progress.points).toBe(first.progress.points);
  expect(store.campaignProgress(p.id).honor).toBe(20);
});
