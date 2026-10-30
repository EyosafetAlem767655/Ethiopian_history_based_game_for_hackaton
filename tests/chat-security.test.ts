import { afterAll, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

process.env.DB_PATH = ':memory:';
const store = await import('../apps/server/src/store');
const { registerTeamChat } = await import('../apps/server/src/chat');
const server = createServer(),
  chat = registerTeamChat(server);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
const sockets: ReturnType<typeof io>[] = [];
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await new Promise<void>((r) => chat.close(() => r()));
});
async function fixture() {
  const p = await store.createProfile('Synthetic chat user', true),
    team = randomUUID();
  await store.db
    .prepare('INSERT INTO squads(id,code,name,demo,members) VALUES (?,?,?,?,?)')
    .run(team, team, 'Private team', 1, JSON.stringify([p.id]));
  return { p, team };
}
function connection(p: Awaited<ReturnType<typeof store.createProfile>>, team: string) {
  const s = io(base, {
    auth: { token: store.token(p), squadId: team },
    transports: ['websocket'],
    autoConnect: false,
    forceNew: true,
    reconnection: false,
  });
  sockets.push(s);
  return s;
}
it('rechecks authorization after an asynchronous history read before emitting private data', async () => {
  const { p, team } = await fixture();
  await store.db
    .prepare(
      'INSERT INTO team_messages(id,squad_id,player_id,client_id,name,text,at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(randomUUID(), team, p.id, randomUUID(), p.name, 'Private synthetic history', Date.now());
  const original = store.db.prepare;
  const spy = vi.spyOn(store.db, 'prepare').mockImplementation((sql) => {
    const query = original(sql);
    if (sql.includes('FROM team_messages') && sql.includes('LIMIT 100'))
      return {
        ...query,
        all: async (...args: unknown[]) => {
          const rows = await query.all(...args);
          // Controlled interleaving at the history-read boundary, before delivery.
          await original('UPDATE squads SET members=? WHERE id=?').run('[]', team);
          return rows;
        },
      };
    return query;
  });
  const s = connection(p, team);
  let delivered = false;
  s.on('chat:history', () => {
    delivered = true;
  });
  const disconnected = new Promise<void>((r) => s.once('disconnect', () => r()));
  try {
    s.connect();
    await disconnected;
    expect(delivered).toBe(false);
  } finally {
    spy.mockRestore();
    s.disconnect();
  }
});
it('caps per-account connections and rejects a packet burst before database work', async () => {
  const { p, team } = await fixture();
  const active: ReturnType<typeof io>[] = [];
  for (let i = 0; i < 4; i++) {
    const s = connection(p, team),
      ready = new Promise<void>((r) => s.once('chat:history', () => r()));
    s.connect();
    await ready;
    active.push(s);
  }
  const extra = connection(p, team);
  const rejected = new Promise<Error>((r) => extra.once('connect_error', r));
  extra.connect();
  expect((await rejected).message).toMatch(/at most four/);
  await new Promise((r) => setTimeout(r, 20));
  const spy = vi.spyOn(store.db, 'prepare');
  try {
    const replies = await Promise.all(
      Array.from(
        { length: 100 },
        () =>
          new Promise<{ ok: boolean; error: string }>((r) =>
            active[0].emit('chat:send', { text: 'Missing required client ID' }, r),
          ),
      ),
    );
    expect(replies.every((r) => !r.ok)).toBe(true);
    expect(replies.some((r) => /Too many requests/.test(r.error))).toBe(true);
    expect(spy.mock.calls.filter(([sql]) => sql.includes('team_messages'))).toHaveLength(0);
  } finally {
    spy.mockRestore();
    for (const s of active) s.disconnect();
    extra.disconnect();
  }
});
