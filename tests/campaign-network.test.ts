import { beforeAll, afterAll, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client, type Room } from 'colyseus.js';
import type { World } from '../packages/shared/src/game';
import { campaignControl } from './campaign-controller';
const base = 'http://localhost:2572';
let child: ChildProcess;
const rooms: Room[] = [];
async function api(path: string, s?: any, body?: unknown) {
  const r = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s?.token ?? '') },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw Error('HTTP ' + r.status);
  return r.json() as Promise<any>;
}
async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Campaign condition did not arrive');
}
beforeAll(async () => {
  child = spawn('node', ['--import', 'tsx', 'apps/server/src/index.ts'], {
    env: { ...process.env, PORT: '2572', DB_PATH: ':memory:', ALLOW_CHAIN_BROADCAST: 'false' },
    stdio: 'pipe',
  });
  let log = '';
  child.stderr?.on('data', (s) => (log += s));
  child.stdout?.on('data', (s) => (log += s));
  const end = Date.now() + 55000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw Error(log);
    try {
      if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Campaign test server unavailable: ' + log);
});
afterAll(() => {
  child?.kill();
});
it('shares an authoritative mission, rejects claims/versions/outsiders, reconnects, and saves both first clears', async () => {
  const a = await api('/session', undefined, { name: 'Campaign Alice', demo: true }),
    b = await api('/session', undefined, { name: 'Campaign Bekele', demo: true }),
    outsider = await api('/session', undefined, { name: 'Outside', demo: true });
  const c = new Client(base.replace(/^http/, 'ws'));
  await expect(
    c.create('campaign', { missionId: 1, demo: true, token: a.token, protocol: 1 }),
  ).rejects.toThrow(/Refresh/);
  await expect(
    c.create('campaign', { missionId: 6, demo: true, token: a.token, protocol: 2 }),
  ).rejects.toThrow(/preceding/);
  const squad = await api('/squad', a, {});
  await api('/squad', b, { code: squad.code });
  const options = { missionId: 1, demo: true, protocol: 2, squadId: squad.id };
  let r1 = await c.joinOrCreate('campaign', { ...options, token: a.token, hero: 0 });
  rooms.push(r1);
  const r2 = await c.joinById(r1.roomId, { ...options, token: b.token, hero: 1 });
  rooms.push(r2);
  let w: World | undefined;
  const wire = (r: Room) => {
    r.onMessage('snapshot', (state: World) => (w = state));
    r.onMessage('identity', () => {});
    r.onMessage('waiting', () => {});
    r.onMessage('result', () => {});
  };
  wire(r1);
  wire(r2);
  await expect(c.joinById(r1.roomId, { ...options, token: outsider.token })).rejects.toThrow(
    /membership/,
  );
  await until(() => !!w && w.tick > 2);
  expect(w!.protocol).toBe(2);
  expect(w!.players.filter((p) => !p.bot)).toHaveLength(2);
  expect(new Set(w!.players.filter((p) => p.kind === 'warrior').map((p) => p.role)).size).toBe(4);
  const p = w!.players.find((p) => p.id === a.profile.id)!;
  const old = p.seq;
  r1.send('input', {
    seq: 90000,
    x: 0,
    y: 0,
    aim: 0,
    attack: false,
    block: false,
    dodge: false,
    ability: false,
    interact: false,
    hp: 999,
    winner: 0,
    missionComplete: true,
  });
  await new Promise((r) => setTimeout(r, 150));
  expect(w!.players.find((p) => p.id === a.profile.id)!.seq).toBe(old);
  expect((await api('/me', a)).campaign.completed).toEqual([]);
  const token = r1.reconnectionToken,
    roomId = r1.roomId;
  (r1.connection as any).close();
  await until(() => w!.players.find((p) => p.id === a.profile.id)!.bot);
  r1 = await c.reconnect(token);
  rooms.push(r1);
  wire(r1);
  expect(r1.roomId).toBe(roomId);
  await until(() => !w!.players.find((p) => p.id === a.profile.id)!.bot);
  const timer = setInterval(() => {
    if (!w || w.finished) return;
    r1.send('input', campaignControl(w, a.profile.id, w.tick * 2));
    r2.send('input', campaignControl(w, b.profile.id, w.tick * 2 + 1));
  }, 34);
  try {
    await until(() => !!w?.finished, 80000);
  } finally {
    clearInterval(timer);
  }
  expect(w!.winner).toBe(0);
  for (const s of [a, b]) {
    const me = await api('/me', s);
    expect(me.campaign.completed).toEqual([1]);
    expect(me.profile.progress.wins).toBe(0);
    expect(me.profile.progress.rating).toBe(1000);
  }
  const history = (await api('/me', a)).history,
    payload = JSON.parse(history[0].payload);
  expect(payload.missionId).toBe(1);
  expect(payload.version).toBe(2);
  expect(history[0].hash).toMatch(/^0x[0-9a-f]{64}$/);
}, 100000);
