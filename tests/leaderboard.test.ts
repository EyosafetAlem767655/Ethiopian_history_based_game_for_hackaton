import { expect, it } from 'vitest';
process.env.DB_PATH = ':memory:';
const store = await import('../apps/server/src/store');
const { leaderboard } = await import('../apps/server/src/leaderboard');
it('queries real SQLite $.rating and tolerates missing, invalid and null legacy JSON', async () => {
  for (const [name, json] of [
    ['High', '{"rating":1700}'],
    ['Legacy', '{}'],
    ['Corrupt', 'broken'],
    ['Null', 'null'],
    ['Missing rating', '{"rating":null}'],
    ['Obsolete rating', '{"rating":"legacy"}'],
  ]) {
    const p = await store.createProfile(name, false);
    await store.db.prepare('UPDATE profiles SET progress=? WHERE id=?').run(json, p.id);
  }
  const rows = await leaderboard(0);
  expect(rows[0].name).toBe('High');
  expect(rows).toHaveLength(6);
  expect(rows.every((p) => Number.isFinite(p.progress.rating))).toBe(true);
  expect(await leaderboard(1)).toEqual([]);
});
it('atomically saves campaign first clears without altering duel statistics', async () => {
  const { campaignWorld, equipCampaign } = await import('../packages/shared/src/campaign');
  const { fighter } = await import('../packages/shared/src/game');
  const p = await store.createProfile('Campaign', true),
    w = campaignWorld(1, true);
  w.players = [equipCampaign(fighter(p.id, p.name), w)];
  w.players[0].honor = 20;
  w.winner = 0;
  w.finished = true;
  expect(await store.recordResult('campaign-first', w, new Date().toISOString())).toBe(true);
  const first = (await store.profile(p.id))!;
  expect(first.progress.wins).toBe(0);
  expect(first.progress.rating).toBe(1000);
  expect((await store.campaignProgress(p.id)).completed).toEqual([1]);
  expect(await store.recordResult('campaign-first', w, new Date().toISOString())).toBe(false);
  await store.recordResult('campaign-replay', w, new Date().toISOString());
  expect((await store.profile(p.id))!.progress.points).toBe(first.progress.points);
  expect((await store.campaignProgress(p.id)).honor).toBe(20);
});
