import { assertHumanBand, readAvatar } from './customization';
import { ageBands } from '../../../packages/shared/src/customization';
import { Room, type Client } from '@colyseus/core';
import { authenticate, db, type Profile } from './store';
import { guardRoomSession, forgetRoomSessions, forgetClientSession } from './session-guard';
export class SquadLobby extends Room {
  maxClients = 4;
  maxMessagesPerSecond = 10;
  members = new Map<
    string,
    {
      id: string;
      name: string;
      ready: boolean;
    }
  >();
  lastChat = new Map<string, number>();
  started = false;
  onCreate(o: { ageBand?: string; squadId: string }) {
    this.setMetadata({ squadId: o.squadId, ageBand: o.ageBand ?? 'solo' });
    if (!ageBands.includes(o.ageBand as any)) this.maxClients = 1;
    this.clock.setInterval(() => this.broadcast('members', [...this.members.values()]), 1000);
    this.onMessage('chat', (c, data) => {
      const now = Date.now();
      if (
        typeof data !== 'string' ||
        data.trim().length < 1 ||
        data.length > 200 ||
        now - (this.lastChat.get(c.sessionId) ?? 0) < 1000
      )
        return;
      this.lastChat.set(c.sessionId, now);
      this.broadcast('chat', {
        name: (c.auth as Profile).name,
        text: data.trim().replace(/[<>]/g, ''),
        at: now,
      });
    });
    this.onMessage('ready', (c, ready) => {
      const member = this.members.get(c.sessionId);
      if (!member || typeof ready !== 'boolean') return;
      member.ready = ready;
      this.broadcast('members', [...this.members.values()]);
      if (
        this.members.size > 0 &&
        [...this.members.values()].every((m) => m.ready) &&
        !this.started
      ) {
        this.started = true;
        this.broadcast('start', {});
        this.clock.setTimeout(() => {
          this.started = false;
          for (const m of this.members.values()) m.ready = false;
          this.broadcast('members', [...this.members.values()]);
        }, 10000);
      }
    });
  }
  async onAuth(
    _c: Client,
    o: {
      token: string;
      squadId: string;
    },
  ) {
    const p = await authenticate(o.token);
    if (o.squadId !== this.metadata.squadId) throw Error('This is another squad’s lobby');
    if (this.maxClients > 1) await assertHumanBand(p.id, this.metadata.ageBand);
    const s = (await db
      .prepare('SELECT members FROM squads WHERE id=? AND demo=?')
      .get(o.squadId, p.demo)) as any;
    if (!s || !JSON.parse(s.members).includes(p.id)) throw Error('Squad membership required');
    if ([...this.members.values()].some((m) => m.id === p.id)) throw Error('Already in lobby');
    guardRoomSession(this, _c, o.token);
    return p;
  }
  onJoin(c: Client, _o: unknown, p: Profile) {
    // Admission must remain unique even when two async onAuth calls overlap.
    if ([...this.members.values()].some((m) => m.id === p.id)) throw Error('Already in lobby');
    this.members.set(c.sessionId, { id: p.id, name: p.name, ready: false });
    this.broadcast('members', [...this.members.values()]);
  }
  onLeave(c: Client) {
    forgetClientSession(this, c);
    this.members.delete(c.sessionId);
    this.lastChat.delete(c.sessionId);
    this.broadcast('members', [...this.members.values()]);
  }
  onDispose() {
    forgetRoomSessions(this);
  }
}
