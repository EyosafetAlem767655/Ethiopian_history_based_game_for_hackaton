import { afterAll, beforeAll, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
process.env.DB_PATH = ':memory:';
const store = await import('../apps/server/src/store');
const { asyncRoutes } = await import('../apps/server/src/routes');
const { registerSocialRoutes } = await import('../apps/server/src/social');
const tournaments = await import('../apps/server/src/tournament');
const live = await import('../apps/server/src/live');

let server: Server, base: string;
const players: Record<string, import('../apps/server/src/store').Profile> = {};
async function call(as: string, path: string, body?: unknown, method?: string) {
  const r = await fetch(base + '/api' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', 'X-Player': as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
beforeAll(async () => {
  for (const name of ['Abebe', 'Bethel', 'Chala'])
    players[name] = await store.createProfile(name, true);
  const app = express();
  asyncRoutes(app);
  app.use(express.json());
  app.use((q, r, next) => {
    r.locals.player = players[String(q.headers['x-player'])];
    next();
  });
  registerSocialRoutes(app);
  tournaments.registerTournamentRoutes(app);
  app.use((err: any, _q: express.Request, r: express.Response, _n: express.NextFunction) =>
    r.status(err.status ?? (err.name === 'ZodError' ? 400 : 500)).json({ error: err.message }),
  );
  server = app.listen(0);
  base = 'http://localhost:' + (server.address() as AddressInfo).port;
});
afterAll(() => server?.close());

it('sends, accepts and notifies friend requests by friend code', async () => {
  const { Abebe, Bethel } = players;
  const code = (await call('Bethel', '/friends')).body.code;
  expect(code).toBe(Bethel.id.slice(0, 8).toUpperCase());
  expect((await call('Abebe', '/friends/request', { code: 'ZZZZZZZZ' })).status).toBe(400);
  expect((await call('Abebe', '/friends/request', { code: Abebe.id.slice(0, 8) })).status).toBe(
    400,
  );
  const sent = await call('Abebe', '/friends/request', { code });
  expect(sent.body.friends).toMatchObject([{ id: Bethel.id, status: 'outgoing' }]);
  const inbox = (await call('Bethel', '/notifications')).body;
  expect(inbox[0]).toMatchObject({ kind: 'friend-request', seen: false });
  expect((await call('Bethel', '/friends')).body.friends[0].status).toBe('incoming');
  await call('Bethel', `/friends/${Abebe.id}/accept`, {});
  expect((await call('Abebe', '/friends')).body.friends[0].status).toBe('accepted');
  expect((await call('Abebe', '/notifications')).body[0].kind).toBe('friend-accepted');
  await call('Bethel', '/notifications/read', {});
  expect((await call('Bethel', '/notifications')).body.every((n: any) => n.seen)).toBe(true);
  // Inviting needs a team room first.
  expect((await call('Abebe', `/friends/${Bethel.id}/invite`, {})).status).toBe(409);
  expect((await call('Chala', `/friends/${Bethel.id}/invite`, {})).status).toBe(403);
});

it('runs a four-seat bracket with AI fill and rewards the champion', async () => {
  const { Abebe, Bethel } = players;
  const t = (await call('Abebe', '/tournament', {})).body;
  expect((await call('Bethel', '/tournament/join', { code: t.code.toLowerCase() })).status).toBe(
    200,
  );
  expect((await call('Bethel', `/tournament/${t.id}/start`, {})).status).toBe(403);
  const started = (await call('Abebe', `/tournament/${t.id}/start`, {})).body;
  expect(started.status).toBe('running');
  expect(started.entrants).toHaveLength(4);
  expect(started.entrants.filter((e: any) => e.bot)).toHaveLength(2);
  expect((await call('Chala', '/tournament/join', { code: t.code })).status).toBe(409);
  const pointsBefore = (await store.profile(Abebe.id))!.progress.points;
  // Abebe wins every match they are in; AI-only semis settle themselves.
  for (let round = 0; round < 3; round++) {
    const now = (await tournaments.tournament(t.id))!;
    if (now.status === 'done') break;
    for (const m of now.bracket)
      if (m.a && m.b && !m.winner) {
        const winner = [m.a, m.b].includes(Abebe.id)
          ? Abebe.id
          : [m.a, m.b].includes(Bethel.id)
            ? [m.a, m.b].find((id) => id !== Bethel.id)!
            : m.a;
        await tournaments.reportTournamentMatch(t.id, m.key, winner, m.key + '-room');
      }
  }
  const done = (await tournaments.tournament(t.id))!;
  expect(done.status).toBe('done');
  expect(done.winner).toBe(Abebe.id);
  const after = (await store.profile(Abebe.id))!.progress.points;
  expect(after - pointsBefore).toBe(2 * tournaments.MATCH_WIN_POINTS + tournaments.CHAMPION_POINTS);
  const champion = (await store.badges(Abebe.id)).find(
    (b: any) => b.badge === 'Tournament Champion',
  );
  // Linked to the recorded final so it can be verified and claimed as ERC-1155 token #12.
  expect(champion?.match_id).toBe('final-room');
  const { badgeTokenId } = await import('../packages/shared/src/web3');
  expect(badgeTokenId('Tournament Champion')).toBe(12);
  const feed = (await call('Abebe', '/notifications')).body.map((n: any) => n.text);
  expect(
    feed.some((text: string) => text.includes('Achievement unlocked: Tournament Champion')),
  ).toBe(true);
  await expect(tournaments.tournamentSeat(t.id, 'final', Abebe.id)).rejects.toThrow();
});

it('lists only started matches with a human player for spectators', () => {
  const world: any = { tick: 0, players: [{ name: 'Abebe', team: 0, bot: false }] };
  live.registerLive('room-1', { label: '1v1 Duel', demo: true, started: 0, world: () => world });
  expect(live.liveMatches(true)).toHaveLength(0);
  world.tick = 40;
  expect(live.liveMatches(true)).toMatchObject([{ id: 'room-1', label: '1v1 Duel' }]);
  expect(live.liveMatches(false)).toHaveLength(0);
  live.unregisterLive('room-1');
  expect(live.liveMatches(true)).toHaveLength(0);
});

it('reserves the Royal Feast armor until identity is verified, then grants it', async () => {
  const p = players.Chala;
  expect(store.equippedArmor((await store.profile(p.id))!)).toBeUndefined();
  await store.issueBadge(p.id, 'Proof of Fellowship', 'gathering-1');
  const reserved = (await store.profile(p.id))!;
  expect(reserved.progress.armor ?? []).toEqual([]);
  expect(reserved.progress.armorPending).toEqual([store.ROYAL_FEAST]);
  expect(store.equippedArmor(reserved)).toBeUndefined();
  expect((await call('Chala', '/notifications')).body.map((n: any) => n.kind)).toContain(
    'armor-pending',
  );
  // An approved Fayda review on a hosted account makes the player eligible.
  await store.db.prepare('INSERT INTO hosted_identities(id) VALUES (?)').run(p.id);
  await store.db
    .prepare(
      'INSERT INTO age_reviews(id,player_id,status,birth_date,created,expires) VALUES (?,?,?,?,?,?)',
    )
    .run('chala-review', p.id, 'approved', '1995-05-01', Date.now(), Date.now() + 10000);
  expect(await store.identityVerified(p.id)).toBe(true);
  await store.claimPendingPerks(p.id);
  const granted = (await store.profile(p.id))!;
  expect(granted.progress.armor).toEqual([store.ROYAL_FEAST]);
  expect(granted.progress.armorPending).toEqual([]);
  expect(store.equippedArmor(granted)).toBe(store.ROYAL_FEAST);
  expect((await call('Chala', '/notifications')).body.map((n: any) => n.kind)).toContain('armor');
});
