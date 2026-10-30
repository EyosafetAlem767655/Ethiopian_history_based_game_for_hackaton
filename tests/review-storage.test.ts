import { it, expect, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
const fixture = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  gate: Promise.resolve(),
  started: false,
  actor: '00000000-0000-4000-8000-000000000099',
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: fixture.actor } }, error: null }) },
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Buffer) => {
          fixture.started = true;
          await fixture.gate;
          fixture.objects.set(path, bytes);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) fixture.objects.delete(p);
          return { error: null };
        },
        download: async (path: string) => ({
          data: fixture.objects.has(path) ? new Blob(['synthetic']) : null,
          error: null,
        }),
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://fixture.invalid/private' },
          error: null,
        }),
      }),
    },
  }),
}));
it('fences late uploads without blocking unrelated users, checks MFA/self-review and deletes evidence on decisions', async () => {
  process.env.DB_PATH = ':memory:';
  process.env.PERSISTENCE = 'sqlite';
  process.env.SUPABASE_URL = 'https://fixture.invalid';
  process.env.SUPABASE_SECRET_KEY = 'fixture';
  process.env.AGE_REVIEWER_IDS = fixture.actor;
  const store = await import('../apps/server/src/store');
  const { registerCustomization, eligibility } = await import('../apps/server/src/customization');
  const { asyncRoutes } = await import('../apps/server/src/routes');
  const player = await store.createProfile('Synthetic document user', false);
  await store.db
    .prepare('INSERT INTO hosted_identities(id,auth_id) VALUES (?,?)')
    .run(player.id, player.id);
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
  registerCustomization(app);
  app.use((e: Error, _q: express.Request, r: express.Response, _next: express.NextFunction) =>
    r.status(400).json({ error: e.message }),
  );
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const jwt = (aal: string) =>
    'header.' + Buffer.from(JSON.stringify({ aal })).toString('base64url') + '.signature';
  const headers = {
    Authorization: 'Bearer ' + store.token(player),
    'Content-Type': 'application/json',
  };
  const request = (
    path: string,
    body?: unknown,
    method = 'POST',
    extra: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:${port}/api` + path, {
      method,
      headers: { ...headers, ...extra },
      body:
        body === undefined
          ? undefined
          : Buffer.isBuffer(body)
            ? new Uint8Array(body).buffer
            : JSON.stringify(body),
    });
  const metadata = {
    document: 'fayda',
    consent: true,
    birth: { year: 2000, month: 1, day: 1, calendar: 'gregorian' },
  };
  const image = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
    'hex',
  );
  const upload = (id: string) =>
    request('/age-review/' + id + '/evidence', image, 'POST', {
      'Content-Type': 'image/png',
      'X-Document-Consent': 'true',
    });
  try {
    let release!: () => void;
    fixture.gate = new Promise<void>((r) => (release = r));
    const first = await (await request('/age-review', metadata)).json();
    const uploading = upload(first.id);
    for (let n = 0; n < 100 && !fixture.started; n++) await new Promise((r) => setTimeout(r, 5));
    expect(fixture.started).toBe(true);
    let reviewed = false;
    const rejecting = request(
      '/admin/age-reviews/' + first.id,
      { decision: 'rejected', acknowledged: true },
      'POST',
      { 'X-Review-Token': jwt('aal2') },
    ).then((r) => {
      reviewed = true;
      return r;
    });
    // An external storage request must not hold the global transaction lock.
    const other = await store.createProfile('Unrelated user', false);
    await store.db.transaction(async () =>
      store.db.prepare('UPDATE profiles SET hero=1 WHERE id=?').run(other.id),
    )();
    expect((await rejecting).status).toBe(200);
    expect(reviewed).toBe(true);
    release();
    expect((await uploading).status).toBe(400);
    expect(fixture.objects.size).toBe(0);
    expect(
      await store.db
        .prepare('SELECT path,birth_date,status FROM age_reviews WHERE id=?')
        .get(first.id),
    ).toEqual({ path: null, birth_date: null, status: 'rejected' });
    const second = await (await request('/age-review', metadata)).json();
    expect((await upload(second.id)).status).toBe(200);
    const approval = { decision: 'approved', acknowledged: true, birth: metadata.birth };
    expect(
      (
        await request('/admin/age-reviews/' + second.id, approval, 'POST', {
          'X-Review-Token': jwt('aal1'),
        })
      ).status,
    ).toBe(403);
    fixture.actor = player.id;
    process.env.AGE_REVIEWER_IDS = player.id;
    expect(
      (
        await request('/admin/age-reviews/' + second.id, approval, 'POST', {
          'X-Review-Token': jwt('aal2'),
        })
      ).status,
    ).toBe(403);
    fixture.actor = '00000000-0000-4000-8000-000000000099';
    process.env.AGE_REVIEWER_IDS = fixture.actor;
    expect(
      (
        await request('/admin/age-reviews/' + second.id, approval, 'POST', {
          'X-Review-Token': jwt('aal2'),
        })
      ).status,
    ).toBe(200);
    expect(fixture.objects.size).toBe(0);
    expect((await eligibility(player.id)).band).not.toBeNull();
    expect((await request('/age-review', undefined, 'DELETE')).status).toBe(200);
    expect((await eligibility(player.id)).band).toBeNull();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
