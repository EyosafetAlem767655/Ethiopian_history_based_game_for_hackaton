import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { Client, type Room } from 'colyseus.js';
import type {
  ChatAck,
  ChatClientEvents,
  ChatServerEvents,
  TeamMessage,
  TeamPresence,
} from '../packages/shared/src/chat';

const base = 'http://localhost:2576',
  sockets: Socket[] = [],
  rooms: Room[] = [];
const database = `output/tests/chat-${randomUUID()}.sqlite`;
let child: ChildProcess;
async function api(path: string, player?: any, body?: unknown) {
  const response = await fetch(base + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (player?.token ?? ''),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw Error('HTTP ' + response.status);
  return response.json() as Promise<any>;
}
async function startServer() {
  child = spawn('node', ['--import', 'tsx', 'apps/server/src/index.ts'], {
    env: {
      ...process.env,
      DB_PATH: database,
      PORT: '2576',
      CORS_ORIGINS: 'http://localhost:5173',
      ALLOW_CHAIN_BROADCAST: 'false',
    },
    stdio: 'pipe',
  });
  let log = '';
  child.stderr?.on('data', (s) => {
    log += s;
  });
  child.stdout?.on('data', (s) => {
    log += s;
  });
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw Error(log);
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch {
      /* Starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Chat server did not start: ' + log);
}
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error('Chat event did not arrive');
}
const player = (name: string) => api('/session', undefined, { name, demo: true });
async function connect(
  p: any,
  squadId: string,
  transport: 'websocket' | 'polling' = 'websocket',
  origin?: string,
) {
  const socket = io(base, {
    auth: { token: p.token, squadId },
    transports: [transport],
    reconnection: false,
    autoConnect: false,
    forceNew: true,
    timeout: 2000,
    extraHeaders: origin ? { Origin: origin } : {},
  }) as Socket<ChatServerEvents, ChatClientEvents>;
  sockets.push(socket);
  const messages: TeamMessage[] = [],
    history: TeamMessage[][] = [],
    errors: string[] = [];
  let presence: TeamPresence = { members: [], online: [] };
  socket.on('chat:message', (m) => messages.push(m));
  socket.on('chat:history', (h) => history.push(h));
  socket.on('chat:members', (state) => {
    presence = state;
  });
  socket.on('chat:error', (message) => errors.push(message));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  await until(() => history.length > 0);
  return { socket, messages, history, errors, presence: () => presence };
}
function send(
  socket: Socket<ChatServerEvents, ChatClientEvents>,
  text: string,
  clientId = randomUUID(),
): Promise<ChatAck> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(2000)
      .emit('chat:send', { clientId, text }, (error: Error | null, ack: ChatAck) =>
        error ? reject(error) : resolve(ack),
      ),
  );
}
beforeAll(async () => {
  mkdirSync('output/tests', { recursive: true });
  await startServer();
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await Promise.allSettled(rooms.splice(0).map((room) => room.leave()));
});
afterAll(() => {
  child?.kill();
});

it('requires a valid session, team membership and an allowed website origin', async () => {
  const a = await player('Owner'),
    b = await player('Outsider'),
    team = await api('/squad', a, {});
  await expect(connect({ token: 'forged' }, team.id)).rejects.toThrow();
  await expect(connect(b, team.id)).rejects.toThrow();
  await expect(connect(a, team.id, 'websocket', 'https://other.example')).rejects.toThrow();
});

it('delivers text to teammates, isolates other rooms and reports authenticated presence', async () => {
  const a = await player('Chat Alice'),
    b = await player('Chat Bekele'),
    c = await player('Other Team'),
    team = await api('/squad', a, {}),
    other = await api('/squad', c, {});
  await api('/squad', b, { code: team.code });
  const sender = await connect(a, team.id),
    receiver = await connect(b, team.id),
    outsider = await connect(c, other.id);
  await until(() => sender.presence().online.length === 2);
  const ack = await send(sender.socket, 'Hello team');
  expect(ack.ok).toBe(true);
  await until(() => receiver.messages.length === 1);
  expect(receiver.messages[0]).toMatchObject({
    playerId: a.profile.id,
    name: 'Chat Alice',
    text: 'Hello team',
  });
  expect(sender.messages).toHaveLength(1);
  expect(outsider.messages).toHaveLength(0);
  expect(
    receiver
      .presence()
      .members.map((p) => p.id)
      .sort(),
  ).toEqual([a.profile.id, b.profile.id].sort());
  expect((await api('/me', b)).squad.id).toBe(team.id);
});

it('rejects empty, oversized and forged messages, and limits rapid sends', async () => {
  const a = await player('Message Guard'),
    team = await api('/squad', a, {}),
    chat = await connect(a, team.id);
  expect((await send(chat.socket, '   ')).ok).toBe(false);
  expect((await send(chat.socket, 'x'.repeat(501))).ok).toBe(false);
  const forged = await new Promise<ChatAck>((resolve) =>
    chat.socket.emit(
      'chat:send',
      {
        clientId: randomUUID(),
        text: 'pretend',
        name: 'Fake Sender',
      } as any,
      resolve,
    ),
  );
  expect(forged.ok).toBe(false);
  expect(chat.messages).toHaveLength(0);
  expect((await send(chat.socket, '<hello>')).ok).toBe(true);
  const limited = await send(chat.socket, 'spam');
  expect(limited).toMatchObject({ ok: false });
  expect(chat.messages).toHaveLength(1);
  expect(chat.messages[0].text).toBe('<hello>');
});

it('acknowledges retries without broadcasting or inserting a duplicate message', async () => {
  const a = await player('Retry Sender'),
    team = await api('/squad', a, {}),
    chat = await connect(a, team.id),
    id = randomUUID();
  const first = await send(chat.socket, 'Once', id),
    retry = await send(chat.socket, 'Once', id);
  expect(retry).toEqual(first);
  expect(chat.messages).toHaveLength(1);
  chat.socket.disconnect();
  const rejoined = await connect(a, team.id);
  expect(rejoined.history[0]).toHaveLength(1);
  expect(rejoined.history[0][0].text).toBe('Once');
});

it('keeps WebSocket chat, polling chat and Colyseus gameplay alive on one port', async () => {
  const a = await player('Shared Port A'),
    b = await player('Shared Port B'),
    team = await api('/squad', a, {});
  await api('/squad', b, { code: team.code });
  const websocket = await connect(a, team.id),
    polling = await connect(b, team.id, 'polling');
  const game = await new Client(base.replace('http', 'ws')).create('battle', {
    mode: 'tutorial',
    demo: true,
    protocol: 2,
    token: a.token,
  });
  rooms.push(game);
  let tick = 0;
  game.onMessage('snapshot', (w) => {
    tick = w.tick;
  });
  game.onMessage('identity', () => {});
  await until(() => tick > 5);
  const before = tick;
  // Engine.IO's default handling of unknown upgrades used to be a potential
  // collision: keep the game alive beyond its one-second destroy timer.
  await new Promise((resolve) => setTimeout(resolve, 1300));
  expect((await send(websocket.socket, 'Still connected during combat')).ok).toBe(true);
  await until(() => polling.messages.length === 1);
  expect(tick).toBeGreaterThan(before);
  expect(websocket.socket.connected).toBe(true);
  expect(polling.socket.connected).toBe(true);
});

it('revokes old-room access when a player switches teams', async () => {
  const a = await player('Moving Player'),
    b = await player('Old Teammate'),
    c = await player('New Team'),
    oldTeam = await api('/squad', a, {}),
    newTeam = await api('/squad', c, {});
  await api('/squad', b, { code: oldTeam.code });
  const moving = await connect(a, oldTeam.id),
    remaining = await connect(b, oldTeam.id);
  await api('/squad', a, { code: newTeam.code });
  expect((await send(remaining.socket, 'Private old-team message')).ok).toBe(true);
  await until(() => !moving.socket.connected);
  expect(moving.messages).toHaveLength(0);
  expect(moving.errors.length).toBeGreaterThan(0);
  await expect(connect(a, oldTeam.id)).rejects.toThrow();
  expect((await connect(a, newTeam.id)).socket.connected).toBe(true);
});

it('restores message history and deduplicates retries after a backend restart', async () => {
  const a = await player('Persistent Chat'),
    team = await api('/squad', a, {}),
    first = await connect(a, team.id),
    id = randomUUID();
  const ack = await send(first.socket, 'Keep this after restart', id);
  first.socket.disconnect();
  const stopped = once(child, 'exit');
  child.kill();
  await stopped;
  await startServer();
  const rejoined = await connect(a, team.id);
  expect(rejoined.history[0]).toHaveLength(1);
  expect(rejoined.history[0][0].text).toBe('Keep this after restart');
  expect(await send(rejoined.socket, 'Keep this after restart', id)).toEqual(ack);
  expect(rejoined.messages).toHaveLength(0);
});
