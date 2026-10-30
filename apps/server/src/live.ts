import type { Namespace, Server } from 'socket.io';
import type { World } from '../../../packages/shared/src/game';
import { authenticate, sessionEvents, sessionFingerprint } from './store';

/**
 * Spectators never join a Colyseus room: matches lock after their start window and seats are
 * fighters. Rooms register here instead and fan their snapshots out to a Socket.IO channel.
 */
interface LiveEntry {
  label: string;
  demo: boolean;
  started: number;
  world: () => World;
}
const rooms = new Map<string, LiveEntry>();
let channel: Namespace | null = null;
const watchRoom = (id: string) => 'watch:' + id;

export function registerLive(id: string, entry: LiveEntry) {
  rooms.set(id, entry);
}
export function unregisterLive(id: string) {
  rooms.delete(id);
  channel?.to(watchRoom(id)).emit('ended');
}
/** Send a snapshot to spectators of this room, if anyone is watching. */
export function publishSnapshot(id: string, w: World) {
  if (channel?.adapter.rooms.get(watchRoom(id))?.size)
    channel.to(watchRoom(id)).emit('snapshot', w);
}
export function liveMatches(demo: boolean) {
  return (
    [...rooms.entries()]
      .filter(([, e]) => e.demo === demo)
      .map(([id, e]) => {
        const w = e.world();
        return {
          id,
          label: e.label,
          started: e.started,
          tick: w.tick,
          players: w.players
            .filter((p) => !p.kind || p.kind === 'warrior')
            .map((p) => ({ name: p.name, team: p.team, bot: !!p.bot })),
          spectators: channel?.adapter.rooms.get(watchRoom(id))?.size ?? 0,
        };
      })
      // Show matches that have actually begun and have at least one human in them.
      .filter((m) => m.tick > 0 && m.players.some((p) => !p.bot))
  );
}
export function registerSpectators(io: Server) {
  channel = io.of('/spectate');
  const watchers = channel;
  // Logging out revokes the token: stop its spectator feeds immediately.
  sessionEvents.on('revoked', (fingerprint: string) => {
    for (const s of watchers.sockets.values())
      if (sessionFingerprint(s.handshake.auth.token) === fingerprint) s.disconnect(true);
  });
  channel.use(async (socket, next) => {
    try {
      const p = await authenticate(socket.handshake.auth.token),
        entry = rooms.get(String(socket.handshake.auth.roomId));
      if (!entry || entry.demo !== !!p.demo) throw Error();
      socket.data.roomId = String(socket.handshake.auth.roomId);
      next();
    } catch {
      next(Error('That match has ended or is not available to watch.'));
    }
  });
  channel.on('connection', async (socket) => {
    const id: string = socket.data.roomId;
    await socket.join(watchRoom(id));
    const entry = rooms.get(id);
    if (entry) socket.emit('snapshot', entry.world());
    else socket.emit('ended');
  });
}
