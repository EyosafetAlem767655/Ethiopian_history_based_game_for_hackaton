import { it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { Client, type Room } from 'colyseus.js';
import { control } from './controller';
import type { World, Mode } from '../packages/shared/src/game';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const base = 'http://localhost:2568';
let process: ChildProcess;
async function request(path: string, session: any, body?: unknown) {
  const r = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (session?.token ?? ''),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error((data as any).error);
  return data as any;
}
beforeAll(async () => {
  mkdirSync('output/tests', { recursive: true });
  process = spawn('node', ['--import', 'tsx', 'apps/server/src/index.ts'], {
    env: {
      ...globalThis.process.env,
      PORT: '2568',
      DB_PATH: ':memory:',
      ALLOW_CHAIN_BROADCAST: 'false',
    },
    stdio: 'pipe',
  });
  let log = '';
  process.stderr?.on('data', (s) => {
    log += s;
  });
  for (let n = 0; n < 240; n++) {
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error('Server did not start ' + log);
}, 90000);
afterAll(() => {
  process?.kill();
});
async function session(name: string) {
  return request('/session', null, { name, demo: true });
}
it('verifies wallet ownership once and rejects simulated gathering for normal guests', async () => {
  const s = await session('Wallet Tester'),
    account = privateKeyToAccount(generatePrivateKey()),
    challenge = await request('/wallet/nonce', s, { address: account.address });
  const signature = await account.signMessage({ message: challenge.message });
  const linked = await request('/wallet/bind', s, { address: account.address, signature });
  expect(linked.verified).toBe(true);
  expect(linked.playerId).toBe(`eip155:84532:${account.address.toLowerCase()}`);
  expect(linked.registration).toBe('off-chain');
  expect((await request('/me', s)).wallet.playerId).toBe(linked.playerId);
  await expect(
    request('/wallet/bind', s, { address: account.address, signature }),
  ).rejects.toThrow();
  const normal = await request('/session', null, { name: 'Normal Guest', demo: false });
  await expect(request('/gathering/demo', normal, { squadId: 'fake' })).rejects.toThrow(
    'demo-only',
  );
});
it('rejects competing wallet links and wallet requests from a different website', async () => {
  const owner = await session('Wallet Owner'),
    other = await session('Other Player'),
    wallet = privateKeyToAccount(generatePrivateKey()),
    a = await request('/wallet/nonce', owner, { address: wallet.address }),
    b = await request('/wallet/nonce', other, { address: wallet.address });
  await request('/wallet/bind', owner, {
    address: wallet.address,
    signature: await wallet.signMessage({ message: a.message }),
  });
  const conflict = await fetch(base + '/api/wallet/bind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + other.token },
    body: JSON.stringify({
      address: wallet.address,
      signature: await wallet.signMessage({ message: b.message }),
    }),
  });
  expect(conflict.status).toBe(409);
  expect((await request('/me', owner)).wallet.address).toBe(wallet.address.toLowerCase());
  expect((await request('/me', other)).wallet.status).toBe('pending');
  for (const path of ['/wallet/nonce', '/wallet/bind']) {
    const denied = await fetch(base + '/api' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + owner.token,
        Origin: 'https://different.example',
      },
      body: JSON.stringify({ address: wallet.address }),
    });
    expect(denied.status).toBe(403);
  }
});
function play(r: Room, id: string, drive = true) {
  let w: World | undefined,
    seq = 0;
  let resolve: (w: World) => void;
  const done = new Promise<World>((r) => (resolve = r));
  r.onMessage('identity', () => {});
  r.onMessage('waiting', () => {});
  r.onMessage('chat', () => {});
  r.onMessage('result', () => {});
  r.onMessage('snapshot', (s: World) => {
    w = s;
    if (s.finished) resolve(s);
  });
  const interval = setInterval(() => {
    if (w && !w.finished && drive) r.send('input', control(w, id, seq++));
  }, 34);
  return { done, stop: () => clearInterval(interval), state: () => w };
}
async function training(s: any) {
  const r = await new Client(base.replace('http', 'ws')).create('battle', {
      mode: 'tutorial',
      demo: true,
      protocol: 2,
      token: s.token,
    }),
    p = play(r, s.profile.id);
  try {
    const w = await p.done;
    expect(w.winner).toBe(0);
  } finally {
    p.stop();
    await r.leave();
  }
}
it('authenticates two clients, exchanges attacks, records one winner and rejects locked progression', async () => {
  const a = await session('Network A'),
    b = await session('Network B');
  await expect(
    new Client(base.replace('http', 'ws')).create('quest', {
      mode: 'quest',
      demo: true,
      protocol: 2,
      token: a.token,
    }),
  ).rejects.toThrow();
  await Promise.all([training(a), training(b)]);
  const c = new Client(base.replace('http', 'ws')),
    r1 = await c.joinOrCreate('battle', {
      mode: 'duel',
      demo: true,
      protocol: 2,
      token: a.token,
      squadId: '',
    }),
    p1 = play(r1, a.profile.id),
    r2 = await c.joinById(r1.roomId, { mode: 'duel', demo: true, protocol: 2, token: b.token }),
    p2 = play(r2, b.profile.id);
  try {
    const result = await p1.done;
    expect(result.players.filter((p) => !p.bot)).toHaveLength(2);
    expect(result.players.some((p) => p.damage > 0)).toBe(true);
    expect(result.winner).toBeGreaterThanOrEqual(0);
    const me = await request('/me', a);
    expect(me.history.filter((h: any) => JSON.parse(h.payload).mode === 'duel')).toHaveLength(1);
    const other = await p2.done;
    expect(other.winner).toBe(result.winner);
  } finally {
    p1.stop();
    p2.stop();
    await r1.leave();
    await r2.leave();
  }
}, 120000);
it('reconnects a dropped authenticated participant into the same live room', async () => {
  const s = await session('Reconnect Knight'),
    c = new Client(base.replace('http', 'ws')),
    r = await c.create('battle', { mode: 'tutorial', demo: true, protocol: 2, token: s.token });
  const p = play(r, s.profile.id, false);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const before = p.state()!;
  const reconnectToken = r.reconnectionToken;
  r.connection.close();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const joined = await c.reconnect(reconnectToken),
    after = play(joined, s.profile.id, false);
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(joined.roomId).toBe(r.roomId);
    expect(after.state()!.players.find((p) => p.id === s.profile.id)?.bot).toBe(false);
    expect(after.state()!.tick).toBeGreaterThan(before.tick);
  } finally {
    p.stop();
    after.stop();
    await joined.leave();
  }
});
it('shares invite-code lobbies, validates chat, and waits for all connected ready flags', async () => {
  const a = await session('Lobby A'),
    b = await session('Lobby B'),
    squad = await request('/squad', a, {});
  const joined = await request('/squad', b, { code: squad.code });
  expect(joined.id).toBe(squad.id);
  const c = new Client(base.replace('http', 'ws')),
    r1 = await c.joinOrCreate('squad-lobby', { squadId: squad.id, protocol: 2, token: a.token }),
    r2 = await c.joinOrCreate('squad-lobby', { squadId: squad.id, protocol: 2, token: b.token });
  let starts = 0;
  const chat: any[] = [];
  for (const r of [r1, r2]) {
    r.onMessage('members', () => {});
    r.onMessage('start', () => starts++);
    r.onMessage('chat', (m) => chat.push(m));
  }
  try {
    r1.send('chat', 'x'.repeat(201));
    r1.send('chat', '<hello>');
    r1.send('chat', 'spam');
    r1.send('ready', true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(starts).toBe(0);
    expect(chat).toHaveLength(2);
    expect(chat[0].text).toBe('hello');
    r2.send('ready', true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(starts).toBe(2);
  } finally {
    await r1.leave();
    await r2.leave();
  }
});
it('restores the completed result when reconnecting during the result-screen grace period', async () => {
  const s = await session('Result Reconnect'),
    c = new Client(base.replace('http', 'ws')),
    r = await c.create('battle', { mode: 'tutorial', demo: true, protocol: 2, token: s.token }),
    p = play(r, s.profile.id);
  await p.done;
  p.stop();
  const key = r.reconnectionToken;
  r.connection.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const reconnected = await c.reconnect(key),
    restored = play(reconnected, s.profile.id, false);
  try {
    const result = await Promise.race([
      restored.done,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(Error('Completed snapshot was not restored')), 2000),
      ),
    ]);
    expect(result.finished).toBe(true);
    expect(result.winner).toBe(0);
    expect((await request('/me', s)).history).toHaveLength(1);
  } finally {
    restored.stop();
    await reconnected.leave();
  }
});
it('completes the demo journey through real simulated inputs and isolated rewards', async () => {
  const s = await session('Story Tester');
  await training(s);
  async function encounter(mode: Mode, squad?: any) {
    const c = new Client(base.replace('http', 'ws')),
      r = await c.create(mode === 'squad' ? 'conquest' : mode === 'quest' ? 'quest' : 'battle', {
        mode,
        demo: true,
        protocol: 2,
        token: s.token,
        squadId: squad?.id ?? '',
      }),
      p = play(r, s.profile.id);
    try {
      return await p.done;
    } finally {
      p.stop();
      await r.leave();
    }
  }
  const duel = await encounter('duel');
  expect(duel.winner).toBe(0);
  const squad = await request('/squad', s, {});
  const conquest = await encounter('squad', squad);
  expect(conquest.players).toHaveLength(8);
  expect(conquest.winner).toBe(0);
  const gathering = await request('/gathering/demo', s, { squadId: squad.id });
  expect(gathering.simulated).toBe(true);
  const finale = await encounter('quest', squad);
  expect(finale.phase).toBe('victory');
  const me = await request('/me', s);
  expect(me.badges.some((b: any) => b.badge === 'Thronebreaker')).toBe(true);
  expect(me.history).toHaveLength(4);
  expect(me.history.every((h: any) => h.status === 'simulated')).toBe(true);
}, 240000);
