import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import { authenticate, db, profile, sessionEvents, sessionFingerprint } from './store';
import { EventEmitter } from 'node:events';
import { persistence } from './database';
import type {
  ChatClientEvents,
  ChatServerEvents,
  TeamMessage,
  TeamMember,
} from '../../../packages/shared/src/chat';

await db.exec(`CREATE TABLE IF NOT EXISTS team_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, squad_id TEXT NOT NULL,
  player_id TEXT NOT NULL, client_id TEXT NOT NULL, name TEXT NOT NULL,
  text TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE(squad_id,player_id,client_id)
);
CREATE INDEX IF NOT EXISTS team_message_history ON team_messages(squad_id,seq);
CREATE INDEX IF NOT EXISTS team_message_rate ON team_messages(player_id,at DESC);`);

export async function squadRoster(squadId: string, demo: number) {
  const row = (await db
    .prepare('SELECT members FROM squads WHERE id=? AND demo=?')
    .get(squadId, demo)) as { members: string } | undefined;
  if (!row) return;
  return Promise.all(
    (JSON.parse(row.members) as string[]).map(async (id) => ({
      id,
      name: (await profile(id))?.name ?? 'Warrior',
    })),
  );
}
export async function currentSquad(playerId: string, demo: number) {
  // Both adapters store members as JSON text; use each database's JSON table function.
  const membership =
    persistence === 'supabase'
      ? 'SELECT 1 FROM jsonb_array_elements_text(squads.members::jsonb) AS member(value) WHERE value=?'
      : 'SELECT 1 FROM json_each(squads.members) WHERE value=?';
  const row = (await db
    .prepare(`SELECT * FROM squads WHERE demo=? AND EXISTS (${membership})`)
    .get(demo, playerId)) as
    | { id: string; name: string; code: string; demo: number; members: string }
    | undefined;
  return row ? { ...row, members: (await squadRoster(row.id, demo))! } : null;
}
const messageSchema = z
  .object({ clientId: z.string().uuid(), text: z.string().trim().min(1).max(500) })
  .strict();
interface ChatData {
  playerId: string;
  squadId: string;
  demo: number;
}
const normalizeMessage = (message: TeamMessage): TeamMessage => ({
  ...message,
  at: Number(message.at),
});

const membershipEvents = new EventEmitter();
export function notifyTeamMembershipChanged(playerId: string) {
  membershipEvents.emit('changed', playerId);
}

export function registerTeamChat(server: HttpServer) {
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (process.env.WALLET_ORIGIN) origins.push(new URL(process.env.WALLET_ORIGIN).origin);
  function permitted(request: IncomingMessage) {
    const origin = request.headers.origin;
    if (!origin || origins.includes(origin)) return true;
    try {
      const url = new URL(origin);
      // Render can serve the frontend itself: that origin needs no extra CORS entry.
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        url.origin === origin &&
        url.host === request.headers.host
      );
    } catch {
      return false;
    }
  }
  const io = new Server<ChatClientEvents, ChatServerEvents, Record<string, never>, ChatData>(
    server,
    {
      cors: { origin: origins },
      allowRequest: (request, callback) => callback(null, permitted(request)),
      maxHttpBufferSize: 16 * 1024,
      // Leave non-Socket.IO WebSocket upgrades to SharedGameTransport.
      destroyUpgrade: false,
    },
  );
  const roomName = (squadId: string) => 'team:' + squadId;
  // Quote camelCase aliases: PostgreSQL otherwise returns `playerid`.
  const selectMessage = 'SELECT id,player_id AS "playerId",name,text,at FROM team_messages';
  const jobs = new Map<string, { tail: Promise<void>; depth: number }>();
  const connections = new Map<string, number>();
  function releaseConnection(id: string) {
    const remaining = (connections.get(id) ?? 1) - 1;
    if (remaining > 0) connections.set(id, remaining);
    else connections.delete(id);
  }
  const budgets = new Map<string, { tokens: number; at: number }>();
  function budget(playerId: string) {
    const now = Date.now(),
      previous = budgets.get(playerId) ?? { tokens: 12, at: now };
    previous.tokens = Math.min(12, previous.tokens + (now - previous.at) / 500);
    previous.at = now;
    if (previous.tokens < 1) {
      budgets.set(playerId, previous);
      return false;
    }
    previous.tokens--;
    budgets.set(playerId, previous);
    return true;
  }
  function enqueue(squadId: string, job: () => Promise<void>) {
    const queue = jobs.get(squadId) ?? { tail: Promise.resolve(), depth: 0 };
    if (queue.depth >= 16) return Promise.reject(Error('Team chat is busy. Please retry.'));
    queue.depth++;
    const next = queue.tail.catch(() => {}).then(job);
    queue.tail = next;
    jobs.set(squadId, queue);
    void next
      .catch((e: Error) => console.error('Team chat:', e.message))
      .finally(() => {
        queue.depth--;
        if (!queue.depth) jobs.delete(squadId);
      });
    return next;
  }
  async function allowed(playerId: string, squadId: string, demo: number) {
    return (await squadRoster(squadId, demo))?.some((p) => p.id === playerId) ?? false;
  }
  async function prune(squadId: string) {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.squadId !== squadId) continue;
      let valid = false;
      try {
        const p = await authenticate(socket.handshake.auth.token);
        valid = p.id === socket.data.playerId && (await allowed(p.id, squadId, p.demo));
      } catch {
        /* Expired sessions must reconnect through authentication. */
      }
      if (!valid) {
        socket.emit(
          'chat:error',
          'Your team membership or session changed. Reopen your team room.',
        );
        socket.disconnect(true);
      }
    }
  }
  async function presence(squadId: string, demo: number) {
    const members = (await squadRoster(squadId, demo)) ?? [];
    const connected = new Set(
      [...io.sockets.sockets.values()]
        .filter((s) => s.data.squadId === squadId)
        .map((s) => s.data.playerId),
    );
    io.to(roomName(squadId)).emit('chat:members', {
      members,
      online: members.filter((p) => connected.has(p.id)),
    });
  }
  function refresh(squadId: string, demo: number) {
    return enqueue(squadId, () =>
      db.transaction(async () => {
        await prune(squadId);
        await presence(squadId, demo);
      })(),
    );
  }
  const changed = (playerId: string) => {
    const teams = new Map<string, number>();
    for (const s of io.sockets.sockets.values())
      if (s.data.playerId === playerId) teams.set(s.data.squadId, s.data.demo);
    for (const [id, demo] of teams) void refresh(id, demo).catch(() => {});
  };
  const revoked = (fingerprint: string) => {
    for (const s of io.sockets.sockets.values())
      if (sessionFingerprint(s.handshake.auth.token) === fingerprint) s.disconnect(true);
  };
  membershipEvents.on('changed', changed);
  sessionEvents.on('revoked', revoked);
  const sweep = setInterval(() => {
    const teams = new Map<string, number>();
    for (const s of io.sockets.sockets.values()) teams.set(s.data.squadId, s.data.demo);
    for (const [id, demo] of teams) void refresh(id, demo).catch(() => {});
    for (const [id, entry] of budgets) if (Date.now() - entry.at > 60000) budgets.delete(id);
  }, 15000).unref();
  server.once('close', () => {
    clearInterval(sweep);
    membershipEvents.off('changed', changed);
    sessionEvents.off('revoked', revoked);
  });
  io.use(async (socket, next) => {
    let counted: string | undefined;
    try {
      // Counts every Socket.IO connection, including notification and spectator feeds.
      if (io.engine.clientsCount > 1000) throw Error('Chat capacity reached');
      const p = await authenticate(socket.handshake.auth.token),
        squadId = socket.handshake.auth.squadId;
      if ((connections.get(p.id) ?? 0) >= 4) throw Error('Too many chat connections');
      connections.set(p.id, (connections.get(p.id) ?? 0) + 1);
      counted = p.id;
      if (
        typeof squadId !== 'string' ||
        squadId.length > 100 ||
        !(await allowed(p.id, squadId, p.demo))
      )
        throw Error('Team membership required');
      socket.data = { playerId: p.id, squadId, demo: p.demo };
      socket.once('disconnect', () => releaseConnection(p.id));
      next();
    } catch {
      if (counted) releaseConnection(counted);
      next(Error('Sign in, join this team, and keep at most four chat connections open.'));
    }
  });
  io.on('connection', (socket) => {
    const { squadId, playerId, demo } = socket.data;
    // Read, authorize and emit inside the same short DB transaction. Membership
    // changes use this transaction boundary too; no network/storage waits belong here.
    void enqueue(squadId, () =>
      db.transaction(async () => {
        await prune(squadId);
        if (!socket.connected) return;
        await socket.join(roomName(squadId));
        const history = (await db
          .prepare(selectMessage + ' WHERE squad_id=? ORDER BY seq DESC LIMIT 100')
          .all(squadId)) as TeamMessage[];
        // A final check also protects against out-of-band changes during the history read.
        if (!(await allowed(playerId, squadId, demo))) {
          socket.disconnect(true);
          return;
        }
        socket.emit('chat:history', history.reverse().map(normalizeMessage));
        await presence(squadId, demo);
      })(),
    ).catch(() => socket.disconnect(true));
    socket.on('chat:send', (data, ack) => {
      if (typeof ack !== 'function') return;
      if (!budget(playerId)) {
        ack({ ok: false, error: 'Too many requests. Please wait.' });
        return;
      }
      const parsed = messageSchema.safeParse(data);
      if (!parsed.success) {
        ack({ ok: false, error: 'Send 1–500 characters of plain text.' });
        return;
      }
      const { clientId, text } = parsed.data;
      void enqueue(squadId, () =>
        db.transaction(async () => {
          await prune(squadId);
          if (!socket.connected || !(await allowed(playerId, squadId, demo))) {
            ack({ ok: false, error: 'You are no longer a member of this team.' });
            return;
          }
          const duplicate = (await db
            .prepare(selectMessage + ' WHERE squad_id=? AND player_id=? AND client_id=?')
            .get(squadId, playerId, clientId)) as TeamMessage | undefined;
          if (duplicate) {
            ack({ ok: true, message: normalizeMessage(duplicate) });
            return;
          }
          const now = Date.now();
          const previous = await db
            .prepare('SELECT at FROM team_messages WHERE player_id=? ORDER BY at DESC LIMIT 1')
            .get(playerId);
          if (now - Number(previous?.at ?? 0) < 1000) {
            ack({ ok: false, error: 'Please wait a second before sending another message.' });
            return;
          }
          const message: TeamMessage = {
            id: randomUUID(),
            playerId,
            name: (await profile(playerId))!.name,
            text,
            at: now,
          };
          await db
            .prepare(
              'INSERT INTO team_messages(id,squad_id,player_id,client_id,name,text,at) VALUES (?,?,?,?,?,?,?)',
            )
            .run(message.id, squadId, playerId, clientId, message.name, text, now);
          await prune(squadId);
          io.to(roomName(squadId)).emit('chat:message', message);
          ack({ ok: true, message });
        })(),
      ).catch(() => ack({ ok: false, error: 'Team chat is busy. Please retry.' }));
    });
    socket.on('disconnect', () => {
      void refresh(squadId, demo).catch(() => {});
    });
  });
  return io;
}
