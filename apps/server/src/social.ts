import type { Express } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { authenticate, db, profile, sessionEvents, sessionFingerprint } from './store';
import { currentSquad } from './chat';
import { attachNotifyHub, markSeen, notifications, notify, playerRoom, push } from './notify';

await db.exec(`CREATE TABLE IF NOT EXISTS friends(
  player_id TEXT NOT NULL, friend_id TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL,
  PRIMARY KEY(player_id,friend_id)
);
CREATE INDEX IF NOT EXISTS friend_requests ON friends(friend_id);`);

/** Short shareable code: the first block of the player's UUID. */
export const friendCode = (id: string) => id.slice(0, 8).toUpperCase();
const online = new Map<string, number>();
export const isOnline = (id: string) => (online.get(id) ?? 0) > 0;

async function link(a: string, b: string) {
  return (await db
    .prepare(
      'SELECT * FROM friends WHERE (player_id=? AND friend_id=?) OR (player_id=? AND friend_id=?)',
    )
    .get(a, b, b, a)) as { player_id: string; friend_id: string; status: string } | undefined;
}
async function acceptedFriends(id: string) {
  const rows = (await db
    .prepare(
      "SELECT player_id,friend_id FROM friends WHERE status='accepted' AND (player_id=? OR friend_id=?)",
    )
    .all(id, id)) as { player_id: string; friend_id: string }[];
  return rows.map((r) => (r.player_id === id ? r.friend_id : r.player_id));
}
export async function friendList(id: string) {
  const rows = (await db
    .prepare('SELECT * FROM friends WHERE player_id=? OR friend_id=? ORDER BY created DESC')
    .all(id, id)) as { player_id: string; friend_id: string; status: string }[];
  return Promise.all(
    rows.map(async (r) => {
      const other = r.player_id === id ? r.friend_id : r.player_id;
      return {
        id: other,
        name: (await profile(other))?.name ?? 'Warrior',
        code: friendCode(other),
        status: r.status === 'accepted' ? 'accepted' : r.player_id === id ? 'outgoing' : 'incoming',
        online: isOnline(other),
      };
    }),
  );
}
const fail = (status: number, message: string) => Object.assign(Error(message), { status });

export function registerSocialRoutes(app: Express) {
  app.get('/api/friends', async (_q, r) => {
    const me = r.locals.player;
    r.json({ code: friendCode(me.id), friends: await friendList(me.id) });
  });
  app.post('/api/friends/request', async (q, r) => {
    const me = r.locals.player;
    const { code } = z
      .object({
        code: z
          .string()
          .trim()
          .regex(/^[0-9a-fA-F]{8}$/),
      })
      .parse(q.body);
    const target = (await db
      .prepare('SELECT id,name FROM profiles WHERE id LIKE ? AND demo=?')
      .get(code.toLowerCase() + '-%', me.demo)) as { id: string; name: string } | undefined;
    if (!target) throw fail(404, 'No warrior found with that friend code.');
    if (target.id === me.id) throw fail(400, 'That is your own friend code.');
    const existing = await link(me.id, target.id);
    if (existing?.status === 'accepted') throw fail(409, 'You are already friends.');
    if (existing && existing.player_id === target.id) {
      // They already asked us: treat our request as acceptance.
      await db
        .prepare("UPDATE friends SET status='accepted' WHERE player_id=? AND friend_id=?")
        .run(target.id, me.id);
      await notify(target.id, 'friend-accepted', `${me.name} accepted your friend request.`);
    } else if (!existing) {
      await db
        .prepare("INSERT INTO friends(player_id,friend_id,status,created) VALUES (?,?,'pending',?)")
        .run(me.id, target.id, Date.now());
      await notify(target.id, 'friend-request', `${me.name} sent you a friend request.`, {
        from: me.id,
      });
    }
    r.json({ friends: await friendList(me.id) });
  });
  app.post('/api/friends/:id/accept', async (q, r) => {
    const me = r.locals.player;
    const out = await db
      .prepare(
        "UPDATE friends SET status='accepted' WHERE player_id=? AND friend_id=? AND status='pending'",
      )
      .run(q.params.id, me.id);
    if (!out.changes) throw fail(404, 'Friend request not found.');
    await notify(q.params.id, 'friend-accepted', `${me.name} accepted your friend request.`);
    r.json({ friends: await friendList(me.id) });
  });
  app.delete('/api/friends/:id', async (q, r) => {
    const me = r.locals.player;
    await db
      .prepare(
        'DELETE FROM friends WHERE (player_id=? AND friend_id=?) OR (player_id=? AND friend_id=?)',
      )
      .run(me.id, q.params.id, q.params.id, me.id);
    r.json({ friends: await friendList(me.id) });
  });
  app.post('/api/friends/:id/invite', async (q, r) => {
    const me = r.locals.player;
    if ((await link(me.id, q.params.id))?.status !== 'accepted')
      throw fail(403, 'You can only invite friends.');
    const squad = await currentSquad(me.id, me.demo);
    if (!squad) throw fail(409, 'Open your Team room first, then invite friends to it.');
    await notify(q.params.id, 'squad-invite', `${me.name} invited you to team ${squad.name}.`, {
      code: squad.code,
    });
    r.json({ ok: true });
  });
  app.get('/api/notifications', async (_q, r) => {
    r.json(await notifications(r.locals.player.id));
  });
  app.post('/api/notifications/read', async (_q, r) => {
    await markSeen(r.locals.player.id);
    r.json({ ok: true });
  });
}

/** Per-player live channel for notifications and friend presence, on the shared Socket.IO server. */
export function registerNotifySocket(io: Server) {
  const hub = io.of('/notify');
  attachNotifyHub(hub);
  // Logging out revokes the token: close its notification sockets immediately.
  sessionEvents.on('revoked', (fingerprint: string) => {
    for (const s of hub.sockets.values())
      if (sessionFingerprint(s.handshake.auth.token) === fingerprint) s.disconnect(true);
  });
  hub.use(async (socket, next) => {
    try {
      socket.data.playerId = (await authenticate(socket.handshake.auth.token)).id;
      next();
    } catch {
      next(Error('Sign in again to receive notifications.'));
    }
  });
  hub.on('connection', async (socket) => {
    const id: string = socket.data.playerId;
    await socket.join(playerRoom(id));
    const count = (online.get(id) ?? 0) + 1;
    online.set(id, count);
    if (count === 1) {
      const name = (await profile(id))?.name ?? 'A friend';
      for (const friend of await acceptedFriends(id))
        push(friend, 'friend-online', `${name} is online.`, { id });
    }
    socket.on('disconnect', () => {
      const left = (online.get(id) ?? 1) - 1;
      if (left > 0) online.set(id, left);
      else online.delete(id);
    });
  });
}
