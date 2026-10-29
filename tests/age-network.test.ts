import { it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from 'colyseus.js';
import { defaultAvatar } from '../packages/shared/src/customization';
const base = 'http://localhost:2573';
let child: ChildProcess;
async function request(path: string, s?: any, body?: unknown, method?: string) {
  return fetch(base + '/api' + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s?.token ?? '') },
    body: body ? JSON.stringify(body) : undefined,
  });
}
beforeAll(async () => {
  child = spawn('node', ['--import', 'tsx', 'apps/server/src/index.ts'], {
    env: { ...process.env, PORT: '2573', PERSISTENCE: 'sqlite', DB_PATH: ':memory:' },
    stdio: 'pipe',
  });
  let log = '';
  child.stderr?.on('data', (v) => (log += v));
  for (let n = 0; n < 200; n++) {
    try {
      if ((await request('/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(log);
}, 30000);
afterAll(() => child?.kill());
it('protects all human room types and private invites while allowing solo, avatars and private review status', async () => {
  const a = await (
      await request('/session', undefined, { name: 'Unreviewed A', demo: true })
    ).json(),
    b = await (await request('/session', undefined, { name: 'Unreviewed B', demo: true })).json();
  const c = new Client(base.replace('http', 'ws'));
  for (const [room, options] of [
    ['battle', { mode: 'duel' }],
    ['conquest', { mode: 'squad' }],
    ['quest', { mode: 'quest' }],
    ['campaign', { missionId: 1, squadId: 'fake' }],
    ['squad-lobby', { squadId: 'fake' }],
  ] as const)
    await expect(
      c.create(room, { ...options, protocol: 2, demo: true, ageBand: '18–24', token: a.token }),
    ).rejects.toThrow(/reviewed/);
  const squad = await (await request('/squad', a, {})).json();
  expect((await request('/squad', b, { code: squad.code })).status).toBe(403);
  const solo = await c.create('battle', {
    mode: 'tutorial',
    protocol: 2,
    demo: true,
    token: a.token,
  });
  solo.onMessage('identity', () => {});
  solo.onMessage('snapshot', () => {});
  solo.onMessage('waiting', () => {});
  await expect(
    c.joinById(solo.roomId, { mode: 'tutorial', protocol: 2, demo: true, token: b.token }),
  ).rejects.toThrow();
  await solo.leave();
  const update = await request('/avatar', a, { ...defaultAvatar, hair: 'braids' }, 'PUT');
  expect(update.status).toBe(200);
  const me = await (await request('/me', a)).json();
  expect(me.avatar.hair).toBe('braids');
  expect(me).not.toHaveProperty('birth_date');
  expect(
    (
      await request(
        '/avatar',
        a,
        { ...defaultAvatar, selfie: 'data:image/png;base64,private' },
        'PUT',
      )
    ).status,
  ).toBe(400);
  const age = await (await request('/age-review', a)).json();
  expect(age.enabled).toBe(false);
  expect(age.band).toBeNull();
  expect((await request('/admin/age-reviews', a)).status).toBe(403);
  expect(
    (await request('/admin/age-reviews/fake', a, { decision: 'approved', acknowledged: true }))
      .status,
  ).toBe(403);
  expect(
    (
      await request('/age-review', a, {
        consent: true,
        document: 'fayda',
        birth: { year: 2000, month: 1, day: 1, calendar: 'gregorian' },
      })
    ).status,
  ).toBe(503);
});
