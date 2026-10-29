import type { Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import { authenticate, db, profile } from './store';
import type {
  ChatClientEvents,
  ChatServerEvents,
  TeamMessage,
  TeamMember,
} from '../../../packages/shared/src/chat';

db.exec(`CREATE TABLE IF NOT EXISTS team_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, squad_id TEXT NOT NULL,
  player_id TEXT NOT NULL, client_id TEXT NOT NULL, name TEXT NOT NULL,
  text TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE(squad_id,player_id,client_id)
);
CREATE INDEX IF NOT EXISTS team_message_history ON team_messages(squad_id,seq);`);

export function squadRoster(squadId: string, demo: number) {
  const row = db.prepare('SELECT members FROM squads WHERE id=? AND demo=?').get(squadId, demo) as
    | { members: string }
    | undefined;
  if (!row) return;
  return (JSON.parse(row.members) as string[]).map((id) => ({
    id,
    name: profile(id)?.name ?? 'Warrior',
  }));
}
export function currentSquad(playerId: string, demo: number) {
  const row = db
    .prepare(
      `SELECT * FROM squads WHERE demo=? AND EXISTS
    (SELECT 1 FROM json_each(squads.members) WHERE value=?)`,
    )
    .get(demo, playerId) as
    | { id: string; name: string; code: string; demo: number; members: string }
    | undefined;
  return row ? { ...row, members: squadRoster(row.id, demo)! } : null;
}
const messageSchema = z
  .object({ clientId: z.string().uuid(), text: z.string().trim().min(1).max(500) })
  .strict();
interface ChatData {
  playerId: string;
  squadId: string;
  demo: number;
}

export function registerTeamChat(server: HttpServer) {
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((v) => v.trim());
  const io = new Server<ChatClientEvents, ChatServerEvents, Record<string, never>, ChatData>(
    server,
    {
      cors: { origin: origins },
      allowRequest: (request, callback) =>
        callback(null, !request.headers.origin || origins.includes(request.headers.origin)),
      maxHttpBufferSize: 16 * 1024,
      // Leave non-Socket.IO WebSocket upgrades to SharedGameTransport.
      destroyUpgrade: false,
    },
  );
  const lastMessage = new Map<string, number>();
  const roomName = (squadId: string) => 'team:' + squadId;
  const selectMessage = 'SELECT id,player_id AS playerId,name,text,at FROM team_messages';
  function allowed(playerId: string, squadId: string, demo: number) {
    return squadRoster(squadId, demo)?.some((p) => p.id === playerId) ?? false;
  }
  function prune(squadId: string) {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.squadId !== squadId) continue;
      let valid = false;
      try {
        const p = authenticate(socket.handshake.auth.token);
        valid = p.id === socket.data.playerId && allowed(p.id, squadId, p.demo);
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
  function presence(squadId: string, demo: number) {
    const online = new Map<string, TeamMember>();
    for (const socket of io.sockets.sockets.values())
      if (socket.data.squadId === squadId)
        online.set(socket.data.playerId, {
          id: socket.data.playerId,
          name: profile(socket.data.playerId)?.name ?? 'Warrior',
        });
    io.to(roomName(squadId)).emit('chat:members', {
      members: squadRoster(squadId, demo) ?? [],
      online: [...online.values()],
    });
  }
  io.use((socket, next) => {
    try {
      const p = authenticate(socket.handshake.auth.token),
        squadId = socket.handshake.auth.squadId;
      if (typeof squadId !== 'string' || !allowed(p.id, squadId, p.demo))
        throw Error('Team membership required');
      socket.data = { playerId: p.id, squadId, demo: p.demo };
      next();
    } catch {
      next(Error('Sign in and join this team before opening its chat.'));
    }
  });
  io.on('connection', (socket) => {
    const { squadId, playerId, demo } = socket.data;
    prune(squadId);
    void socket.join(roomName(squadId));
    const history = db
      .prepare(selectMessage + ' WHERE squad_id=? ORDER BY seq DESC LIMIT 100')
      .all(squadId) as TeamMessage[];
    socket.emit('chat:history', history.reverse());
    presence(squadId, demo);
    socket.on('chat:send', (data, ack) => {
      if (typeof ack !== 'function') return;
      prune(squadId);
      if (!socket.connected || !allowed(playerId, squadId, demo)) {
        ack({ ok: false, error: 'You are no longer a member of this team.' });
        return;
      }
      const parsed = messageSchema.safeParse(data);
      if (!parsed.success) {
        ack({ ok: false, error: 'Send 1–500 characters of plain text.' });
        return;
      }
      const { clientId, text } = parsed.data;
      const duplicate = db
        .prepare(selectMessage + ' WHERE squad_id=? AND player_id=? AND client_id=?')
        .get(squadId, playerId, clientId) as TeamMessage | undefined;
      if (duplicate) {
        ack({ ok: true, message: duplicate });
        return;
      }
      const now = Date.now();
      if (now - (lastMessage.get(playerId) ?? 0) < 1000) {
        ack({ ok: false, error: 'Please wait a second before sending another message.' });
        return;
      }
      const message: TeamMessage = {
        id: randomUUID(),
        playerId,
        name: profile(playerId)!.name,
        text,
        at: now,
      };
      try {
        db.prepare(
          'INSERT INTO team_messages(id,squad_id,player_id,client_id,name,text,at) VALUES (?,?,?,?,?,?,?)',
        ).run(message.id, squadId, playerId, clientId, message.name, text, now);
      } catch {
        ack({ ok: false, error: 'Message could not be saved. Please retry.' });
        return;
      }
      lastMessage.set(playerId, now);
      io.to(roomName(squadId)).emit('chat:message', message);
      ack({ ok: true, message });
    });
    socket.on('disconnect', () => presence(squadId, demo));
  });
  const cleanup = setInterval(() => {
    for (const [id, time] of lastMessage) if (Date.now() - time > 60000) lastMessage.delete(id);
  }, 60000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return io;
}
