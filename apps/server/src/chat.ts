import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import { authenticate, db, profile } from './store';
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
  const jobs = new Map<string, Promise<void>>();
  function enqueue(squadId: string, job: () => Promise<void>) {
    const next = (jobs.get(squadId) ?? Promise.resolve()).catch(() => {}).then(job);
    jobs.set(squadId, next);
    void next
      .catch((e: Error) => console.error('Team chat:', e.message))
      .finally(() => {
        if (jobs.get(squadId) === next) jobs.delete(squadId);
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
    const online = new Map<string, TeamMember>();
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.squadId !== squadId) continue;
      online.set(socket.data.playerId, {
        id: socket.data.playerId,
        name: (await profile(socket.data.playerId))?.name ?? 'Warrior',
      });
    }
    io.to(roomName(squadId)).emit('chat:members', {
      members: (await squadRoster(squadId, demo)) ?? [],
      online: [...online.values()],
    });
  }
  io.use(async (socket, next) => {
    try {
      const p = await authenticate(socket.handshake.auth.token),
        squadId = socket.handshake.auth.squadId;
      if (typeof squadId !== 'string' || !(await allowed(p.id, squadId, p.demo)))
        throw Error('Team membership required');
      socket.data = { playerId: p.id, squadId, demo: p.demo };
      next();
    } catch {
      next(Error('Sign in and join this team before opening its chat.'));
    }
  });
  io.on('connection', (socket) => {
    const { squadId, playerId, demo } = socket.data;
    // Queue room work so async reads cannot reorder history, sends and membership updates.
    void enqueue(squadId, async () => {
      await prune(squadId);
      if (!socket.connected) return;
      await socket.join(roomName(squadId));
      const history = (await db
        .prepare(selectMessage + ' WHERE squad_id=? ORDER BY seq DESC LIMIT 100')
        .all(squadId)) as TeamMessage[];
      socket.emit('chat:history', history.reverse().map(normalizeMessage));
      await presence(squadId, demo);
    });
    socket.on('chat:send', (data, ack) => {
      if (typeof ack !== 'function') return;
      void enqueue(squadId, async () => {
        await prune(squadId);
        if (!socket.connected || !(await allowed(playerId, squadId, demo))) {
          ack({ ok: false, error: 'You are no longer a member of this team.' });
          return;
        }
        const parsed = messageSchema.safeParse(data);
        if (!parsed.success) {
          ack({ ok: false, error: 'Send 1–500 characters of plain text.' });
          return;
        }
        const { clientId, text } = parsed.data;
        // The shared adapter serializes this transaction, including across Postgres writers.
        const outcome = await db.transaction(async () => {
          if (!(await allowed(playerId, squadId, demo)))
            return { error: 'You are no longer a member of this team.' };
          const duplicate = (await db
            .prepare(selectMessage + ' WHERE squad_id=? AND player_id=? AND client_id=?')
            .get(squadId, playerId, clientId)) as TeamMessage | undefined;
          if (duplicate) return { message: normalizeMessage(duplicate), duplicate: true };
          const now = Date.now();
          const previous = (await db
            .prepare('SELECT at FROM team_messages WHERE player_id=? ORDER BY at DESC LIMIT 1')
            .get(playerId)) as { at: number } | undefined;
          if (now - Number(previous?.at ?? 0) < 1000)
            return { error: 'Please wait a second before sending another message.' };
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
          return { message, duplicate: false };
        })();
        if (outcome.error || !outcome.message) {
          ack({ ok: false, error: outcome.error ?? 'Message could not be saved. Please retry.' });
          return;
        }
        // Recheck before delivery because team membership may change while the write awaits.
        await prune(squadId);
        if (!outcome.duplicate) io.to(roomName(squadId)).emit('chat:message', outcome.message);
        ack({ ok: true, message: outcome.message });
      }).catch(() => ack({ ok: false, error: 'Message could not be saved. Please retry.' }));
    });
    socket.on('disconnect', () => {
      void enqueue(squadId, async () => {
        await prune(squadId);
        await presence(squadId, demo);
      });
    });
  });
  return io;
}
