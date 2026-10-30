import { it, expect, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';

const fixture = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  gate: Promise.resolve(),
  started: false,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Buffer) => {
          fixture.started = true;
          await fixture.gate;
          fixture.objects.set(path, bytes);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const path of paths) fixture.objects.delete(path);
          return { error: null };
        },
      }),
    },
  }),
}));

it('enforces four-person consent, fences late photo uploads and isolates storage from transactions', async () => {
  process.env.DB_PATH = ':memory:';
  process.env.PERSISTENCE = 'sqlite';
  process.env.SUPABASE_URL = 'https://fixture.invalid';
  process.env.SUPABASE_SECRET_KEY = 'synthetic-only';
  process.env.AGE_REVIEWER_IDS = 'synthetic-reviewer';
  const store = await import('../apps/server/src/store');
  const { registerHostedRoutes } = await import('../apps/server/src/hosted');
  const { registerCustomization } = await import('../apps/server/src/customization');
  const { asyncRoutes } = await import('../apps/server/src/routes');
  const players = await Promise.all(
    [0, 1, 2, 3].map((i) => store.createProfile('Fixture ' + i, false)),
  );
  for (const p of players) {
    p.progress.squadWins = 2;
    p.progress.squadRating = 1100;
    await store.saveProfile(p);
    await store.db
      .prepare('INSERT INTO hosted_identities(id,auth_id) VALUES (?,?)')
      .run(p.id, p.id);
    await store.db
      .prepare(
        'INSERT INTO age_reviews(id,player_id,status,birth_date,created,expires) VALUES (?,?,?,?,?,?)',
      )
      .run(p.id, p.id, 'approved', '2000-01-01', Date.now(), Date.now() + 86400000);
  }
  const ids = players.map((p) => p.id);
  await store.db
    .prepare('INSERT INTO squads(id,code,name,demo,members) VALUES (?,?,?,?,?)')
    .run('fixture-team', 'FIXTURE', 'Fixture', 0, JSON.stringify(ids));
  const app = express();
  asyncRoutes(app);
  app.use(express.json());
  app.use(async (q, r, next) => {
    try {
      r.locals.player = await store.authenticate(q.headers.authorization?.replace('Bearer ', ''));
      next();
    } catch (e) {
      next(e);
    }
  });
  registerHostedRoutes(app);
  registerCustomization(app);
  app.use((e: Error, _q: express.Request, r: express.Response, _next: express.NextFunction) =>
    r.status(400).json({ error: e.message }),
  );
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wRsAAAAASUVORK5CYII=',
    'base64',
  );
  const request = (
    path: string,
    actor = 0,
    method = 'POST',
    body: unknown = { consent: true, revision: 0 },
    extra = {},
  ) =>
    fetch(base + '/api' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + store.token(players[actor]),
        'Content-Type': 'application/json',
        ...extra,
      },
      body:
        method === 'DELETE'
          ? undefined
          : Buffer.isBuffer(body)
            ? new Uint8Array(body).buffer
            : JSON.stringify(body),
    });
  const row = (id: string) =>
    store.db.prepare('SELECT * FROM gathering_sessions WHERE id=?').get(id);
  const seed = async (id: string, approvals: string[] = []) => {
    await store.db
      .prepare(
        'INSERT INTO gathering_sessions(id,squad_id,path,approvals,created) VALUES (?,?,?,?,?)',
      )
      .run(id, 'fixture-team', id + '/old', JSON.stringify(approvals), Date.now());
    fixture.objects.set(id + '/old', image);
  };
  const beginUpload = (path: string, consentHeader: string) => {
    fixture.started = false;
    let release!: () => void;
    fixture.gate = new Promise<void>((r) => {
      release = r;
    });
    const pending = request(path, 0, 'POST', image, {
      'Content-Type': 'image/png',
      [consentHeader]: 'true',
    });
    return { pending, release };
  };
  const waitStarted = async () => {
    for (let i = 0; i < 200 && !fixture.started; i++) await new Promise((r) => setTimeout(r, 5));
    expect(fixture.started).toBe(true);
  };
  try {
    await seed('shrunk');
    await store.db
      .prepare('UPDATE squads SET members=? WHERE id=?')
      .run(JSON.stringify([ids[0]]), 'fixture-team');
    const bypass = await request('/gathering/shrunk/approve');
    expect(bypass.status).toBe(400);
    expect((await bypass.json()).error).toMatch(/Four authenticated/);
    expect((await store.profile(ids[0]))!.progress.stage).not.toBe(3);
    await store.db
      .prepare('UPDATE squads SET members=? WHERE id=?')
      .run(JSON.stringify(ids), 'fixture-team');

    await seed('replacement', ids.slice(0, 3));
    const replacing = beginUpload('/gathering/replacement/photo', 'X-Photo-Consent');
    await waitStarted();
    expect((await request('/gathering/replacement/approve', 3)).status).toBe(400);
    replacing.release();
    expect((await replacing.pending).status).toBe(200);
    const replaced = await row('replacement');
    expect(replaced.verified).toBe(0);
    expect(JSON.parse(replaced.approvals)).toEqual([ids[0]]);
    expect(replaced.path).not.toBe('replacement/old');
    expect((await request('/gathering/replacement/approve', 3)).status).toBe(400);
    const approvals = await Promise.all(
      [1, 2, 3].map((actor) =>
        request('/gathering/replacement/approve', actor, 'POST', {
          consent: true,
          revision: Number(replaced.revision),
        }),
      ),
    );
    expect(approvals.every((r) => r.status === 200)).toBe(true);
    expect((await row('replacement')).verified).toBe(1);
    expect(JSON.parse((await row('replacement')).approvals)).toHaveLength(4);

    await seed('withdrawal');
    const late = beginUpload('/gathering/withdrawal/photo', 'X-Photo-Consent');
    await waitStarted();
    expect((await request('/gathering/withdrawal/photo', 1, 'DELETE')).status).toBe(200);
    expect((await row('withdrawal')).path).toBeNull();
    late.release();
    expect((await late.pending).status).toBe(400);
    expect((await row('withdrawal')).path).toBeNull();
    expect([...fixture.objects.keys()].some((key) => key.startsWith('withdrawal/'))).toBe(false);

    await store.db
      .prepare(
        'INSERT INTO age_reviews(id,player_id,status,path,birth_date,created,expires) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        'slow-evidence',
        ids[0],
        'pending',
        null,
        '2000-01-01',
        Date.now(),
        Date.now() + 86400000,
      );
    const blocked = beginUpload('/age-review/slow-evidence/evidence', 'X-Document-Consent');
    await waitStarted();
    let unrelatedDone = false;
    const unrelated = store.db.transaction(async () => {
      await store.db.prepare('UPDATE profiles SET name=? WHERE id=?').run('Unrelated user', ids[3]);
      unrelatedDone = true;
    })();
    await new Promise((r) => setTimeout(r, 75));
    expect(unrelatedDone).toBe(true);
    blocked.release();
    expect((await blocked.pending).status).toBe(200);
    await unrelated;
    expect(unrelatedDone).toBe(true);

    const original = store.token(players[0]);
    await expect(store.authenticate(original + '.ignored')).rejects.toBeInstanceOf(
      store.SessionError,
    );
    await expect(
      store.authenticate(original.split('.')[0] + '.' + 'é'.repeat(43)),
    ).rejects.toBeInstanceOf(store.SessionError);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await store.db.close();
  }
});
