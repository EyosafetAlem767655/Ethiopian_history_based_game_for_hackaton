import type { Room, Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { db } from './store';
import { authenticateRoomClient } from './session-guard';

/** Small room-scoped history survives reconnects for the lifetime of this match. */
export function installRoomChat(room: Room, privateSquad = false) {
  const history: { id: string; playerId: string; name: string; text: string; at: number }[] = [];
  const last = new Map<string, number>();
  async function allowed(client: Client) {
    const p = await authenticateRoomClient(room, client);
    if (privateSquad) {
      const squad = await db
        .prepare('SELECT members FROM squads WHERE id=? AND demo=?')
        .get(room.metadata.squadId, p.demo);
      if (!squad || !JSON.parse(squad.members).includes(p.id))
        throw Error('Squad membership changed');
    }
    return p;
  }
  room.onMessage('chat', (client, data) => {
    if (
      typeof data !== 'string' ||
      !data.trim() ||
      data.length > 200 ||
      !room.clients.includes(client)
    )
      return;
    const now = Date.now(),
      id = (client.auth as { id: string }).id;
    if (now - (last.get(id) ?? 0) < 1000) return;
    last.set(id, now); // Reject bursts before async work, including invalid sessions.
    void db
      .transaction(async () => {
        const p = await allowed(client);
        const message = {
          id: randomUUID(),
          playerId: p.id,
          name: p.name,
          text: data.trim(),
          at: now,
        };
        const recipients: Client[] = [];
        for (const recipient of room.clients) {
          try {
            await allowed(recipient);
            recipients.push(recipient);
          } catch {
            recipient.leave(4001, 'Session or team membership changed');
          }
        }
        history.push(message);
        if (history.length > 100) history.shift();
        for (const recipient of recipients) recipient.send('chat', message);
      })()
      .catch(() => client.leave(4001, 'Session or team membership changed'));
  });
  return (client: Client) => {
    void db
      .transaction(async () => {
        await allowed(client);
        client.send('chat:history', [...history]);
      })()
      .catch(() => client.leave(4001, 'Session or team membership changed'));
  };
}
