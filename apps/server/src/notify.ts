import { randomUUID } from 'node:crypto';
import type { Namespace } from 'socket.io';
import { db } from './database';

await db.exec(`CREATE TABLE IF NOT EXISTS notifications(
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
  data TEXT NOT NULL, at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notification_feed ON notifications(player_id,at DESC);`);

export interface Notice {
  id: string;
  kind: string;
  text: string;
  data: Record<string, unknown>;
  at: number;
  seen: boolean;
}
let hub: Namespace | null = null;
/** Called once the Socket.IO /notify namespace exists (see social.ts). */
export function attachNotifyHub(namespace: Namespace) {
  hub = namespace;
}
export const playerRoom = (id: string) => 'player:' + id;
const isBot = (id: string) => !id || id.startsWith('bot') || id.startsWith('ai-');

/** Store a notification and deliver it live to every open tab of that player. */
export async function notify(
  playerId: string,
  kind: string,
  text: string,
  data: Record<string, unknown> = {},
) {
  if (isBot(playerId)) return;
  const notice: Notice = { id: randomUUID(), kind, text, data, at: Date.now(), seen: false };
  await db
    .prepare(
      'INSERT INTO notifications(id,player_id,kind,text,data,at,seen) VALUES (?,?,?,?,?,?,0)',
    )
    .run(notice.id, playerId, kind, text, JSON.stringify(data), notice.at);
  hub?.to(playerRoom(playerId)).emit('notify', notice);
}
/** Live-only toast that is not worth keeping in the feed (e.g. a friend came online). */
export function push(playerId: string, kind: string, text: string, data = {}) {
  if (isBot(playerId)) return;
  hub
    ?.to(playerRoom(playerId))
    .emit('notify', { id: randomUUID(), kind, text, data, at: Date.now(), seen: true });
}
export async function notifications(playerId: string): Promise<Notice[]> {
  const rows = (await db
    .prepare('SELECT * FROM notifications WHERE player_id=? ORDER BY at DESC LIMIT 30')
    .all(playerId)) as any[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    data: JSON.parse(r.data),
    at: Number(r.at),
    seen: !!Number(r.seen),
  }));
}
export async function markSeen(playerId: string) {
  await db.prepare('UPDATE notifications SET seen=1 WHERE player_id=? AND seen=0').run(playerId);
}
