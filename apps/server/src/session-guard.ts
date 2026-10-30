import type { Room, Client } from '@colyseus/core';
import { authenticate, sessionEvents, sessionFingerprint } from './store';

interface Guard {
  client: Client;
  token: string;
  fingerprint: string;
}
const rooms = new Map<Room, Map<string, Guard>>();
sessionEvents.on('revoked', (fingerprint: string) => {
  for (const guards of rooms.values())
    for (const guard of guards.values())
      if (guard.fingerprint === fingerprint) guard.client.leave(4001, 'Session ended');
});
export function guardRoomSession(room: Room, client: Client, token: string) {
  let guards = rooms.get(room);
  if (!guards) {
    guards = new Map();
    rooms.set(room, guards);
    // Also enforce expiry/revocation from another backend process.
    let checking = false;
    room.clock.setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        for (const guard of guards!.values()) {
          try {
            await authenticate(guard.token);
          } catch {
            guard.client.leave(4001, 'Sign in again');
          }
        }
      } finally {
        checking = false;
      }
    }, 15000);
  }
  guards.set(client.sessionId, { client, token, fingerprint: sessionFingerprint(token) });
}
export async function recheckRoomSession(room: Room, previous: Client, current: Client) {
  const guard = rooms.get(room)?.get(previous.sessionId);
  if (!guard) throw Error('Session unavailable');
  await authenticate(guard.token);
  rooms.get(room)!.delete(previous.sessionId);
  guardRoomSession(room, current, guard.token);
}
export function forgetRoomSessions(room: Room) {
  rooms.delete(room);
}
export function forgetClientSession(room: Room, client: Client) {
  rooms.get(room)?.delete(client.sessionId);
}
export async function authenticateRoomClient(room: Room, client: Client) {
  const guard = rooms.get(room)?.get(client.sessionId);
  if (!guard) throw Error('Session unavailable');
  return authenticate(guard.token);
}
