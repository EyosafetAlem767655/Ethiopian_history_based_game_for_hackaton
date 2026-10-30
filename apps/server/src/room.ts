import { assertHumanBand, readAvatar } from './customization';
import { isMatchPool } from '../../../packages/shared/src/customization';
import { Room, type Client } from '@colyseus/core';
import {
  fighter,
  world,
  step,
  inputSchema,
  shuffledRoles,
  type Input,
  type World,
  type Mode,
  type GameEvent,
} from '../../../packages/shared/src/game';
import { authenticate, recordResult, saveProfile, db, equippedArmor, type Profile } from './store';
import { z } from 'zod';
import { PROTOCOL_VERSION } from '../../../packages/shared/src/presentation';
import { publishSnapshot, registerLive, unregisterLive } from './live';
import { notify } from './notify';
import { reportTournamentMatch, tournamentSeat, type MatchKey } from './tournament';
const MODE_LABELS: Record<string, string> = {
  duel: '1v1 Duel',
  squad: '4v4 Banner Conquest',
  quest: 'Royal Quest',
};
import {
  guardRoomSession,
  recheckRoomSession,
  forgetRoomSessions,
  forgetClientSession,
} from './session-guard';
export class BattleRoom extends Room {
  maxClients = 8;
  maxMessagesPerSecond = 80;
  w!: World;
  inputs = new Map<string, Input>();
  started = new Date().toISOString();
  elapsed = 0;
  recorded = false;
  saving = false;
  retryAt = 0;
  joinIds = new Map<string, string>();
  teams = new Map<string, number>();
  roleOrders = [shuffledRoles(), shuffledRoles()];
  eventLog: GameEvent[] = [];
  loggedEvents = new Set<string>();
  /** Seconds to wait for players before AI fills empty seats. */
  waitFor = 5;
  tournament?: { id: string; key: MatchKey };
  onCreate(o: {
    ageBand?: string;
    mode?: Mode;
    demo?: boolean;
    squadId?: string;
    tournamentId?: string;
    matchKey?: MatchKey;
  }) {
    const mode = z.enum(['tutorial', 'duel', 'squad', 'quest']).parse(o.mode ?? 'duel');
    this.maxClients = mode === 'duel' ? 2 : mode === 'tutorial' ? 1 : mode === 'squad' ? 8 : 4;
    this.w = world(mode, !!o.demo);
    if (!isMatchPool(o.ageBand)) {
      this.maxClients = 1;
      void this.setPrivate(true);
    }
    if (mode === 'tutorial') void this.setPrivate(true);
    this.setMetadata({
      mode,
      demo: !!o.demo,
      squadId: o.squadId ?? '',
      ageBand: o.ageBand ?? 'solo',
    });
    if (mode === 'duel' && o.tournamentId && o.matchKey)
      this.tournament = { id: o.tournamentId, key: o.matchKey };
    if (mode !== 'tutorial')
      registerLive(this.roomId, {
        label: this.tournament
          ? 'Tournament ' + (o.matchKey === 'final' ? 'final' : 'semifinal')
          : MODE_LABELS[mode],
        demo: !!o.demo,
        started: Date.now(),
        world: () => this.w,
      });
    this.onMessage('input', (c, data) => {
      const result = inputSchema.safeParse(data);
      if (!result.success) return;
      const id = this.joinIds.get(c.sessionId)!;
      const prev = this.inputs.get(id);
      if (prev && result.data.seq <= prev.seq) return;
      this.inputs.set(id, result.data);
    });
    this.onMessage('chat', (c, data) => {
      if (this.elapsed > this.waitFor || typeof data !== 'string' || data.length > 200) return;
      const now = Date.now();
      const last =
        (
          c.userData as {
            chat?: number;
          }
        )?.chat ?? 0;
      if (now - last < 1000) return;
      c.userData = { chat: now };
      this.broadcast('chat', {
        name: (c.auth as Profile).name,
        text: data.replace(/[<>]/g, ''),
        at: now,
      });
    });
    let accumulator = 0;
    this.setSimulationInterval((delta) => {
      accumulator += Math.min(delta, 250);
      while (accumulator >= 1000 / 30) {
        this.update();
        accumulator -= 1000 / 30;
      }
    }, 1000 / 30);
  }
  async onAuth(
    _c: Client,
    o: {
      token: string;
      demo: boolean;
      mode: Mode;
      squadId?: string;
      protocol?: number;
    },
  ) {
    if (o.protocol !== PROTOCOL_VERSION)
      throw Error('Your game version is outdated. Refresh this page.');
    const p = await authenticate(o.token);
    if (this.maxClients > 1) await assertHumanBand(p.id, this.metadata.ageBand);
    const avatar = await readAvatar(p.id);
    Object.assign(p, { avatar });
    if (this.w.finished) throw Error('Match already completed');
    if (this.elapsed > this.waitFor && this.w.mode !== 'quest')
      throw Error('Match already started');
    if (this.tournament) {
      const seat = await tournamentSeat(this.tournament.id, this.tournament.key, p.id);
      // Give a human opponent time to arrive before an AI takes their seat.
      if (seat.humanOpponent) this.waitFor = 30;
    }
    if (this.w.mode === 'tutorial' && this.w.players.length > 0)
      throw Error('Training is a private session');
    if (Boolean(p.demo) !== !!this.metadata.demo) throw Error('Mode mismatch');
    if (this.w.players.some((f) => f.id === p.id)) throw Error('Already in this match');
    if (this.w.mode === 'duel' && !p.progress.tutorial && !this.tournament)
      throw Error('Complete training first');
    if (this.w.mode === 'squad' && p.progress.stage < 2) throw Error('Stage 2 is locked');
    if (this.w.mode === 'quest' && p.progress.stage < 3) throw Error('Stage 3 is locked');
    if (['squad', 'quest'].includes(this.w.mode)) {
      if (this.w.mode === 'quest' && o.squadId !== this.metadata.squadId)
        throw Error('This is another squad’s quest');
      const s = (await db
        .prepare('SELECT members FROM squads WHERE id=? AND demo=?')
        .get(o.squadId ?? '', p.demo)) as any;
      if (!s || !JSON.parse(s.members).includes(p.id)) throw Error('Squad membership required');
      if (this.w.mode === 'squad' && !this.teams.has(o.squadId!) && this.teams.size >= 2)
        throw Error('Both squads are full');
      const team = this.teams.get(o.squadId!);
      if (
        this.w.mode === 'squad' &&
        team !== undefined &&
        this.w.players.filter((p) => p.team === team).length >= 4
      )
        throw Error('Your team is full');
    }
    guardRoomSession(this, _c, o.token);
    return p;
  }
  async onJoin(
    c: Client,
    o: {
      hero?: number;
      squadId?: string;
    },
    auth: Profile,
  ) {
    const p = auth ?? (c.auth as Profile);
    if (this.elapsed > this.waitFor && this.w.mode !== 'quest')
      throw Error('Match already started');
    if ([...this.joinIds.values()].includes(p.id)) throw Error('Already in this match');
    this.joinIds.set(c.sessionId, p.id);
    p.hero = Math.max(0, Math.min(3, Number(o.hero) || 0));
    try {
      await db.prepare('UPDATE profiles SET hero=? WHERE id=?').run(p.hero, p.id);
    } catch (e) {
      this.joinIds.delete(c.sessionId);
      throw e;
    }
    let team = this.w.mode === 'duel' ? this.w.players.length : 0;
    if (this.w.mode === 'squad') {
      if (
        (!this.teams.has(o.squadId!) && this.teams.size >= 2) ||
        (this.teams.has(o.squadId!) &&
          this.w.players.filter((f) => f.team === this.teams.get(o.squadId!)).length >= 4)
      ) {
        this.joinIds.delete(c.sessionId);
        throw Error('Both squads are full');
      }
      if (!this.teams.has(o.squadId!)) this.teams.set(o.squadId!, this.teams.size);
      team = this.teams.get(o.squadId!)!;
    }
    const replacement =
      this.w.mode === 'quest' ? this.w.players.find((p) => p.bot && p.team === 0) : undefined;
    if (replacement) this.w.players = this.w.players.filter((p) => p.id !== replacement.id);
    const f = fighter(
      p.id,
      p.name,
      team,
      false,
      p.hero,
      ['duel', 'tutorial'].includes(this.w.mode)
        ? 'guardian'
        : (replacement?.role ??
            this.roleOrders[team][this.w.players.filter((q) => q.team === team).length % 4]),
    );
    if (replacement) {
      f.x = replacement.x;
      f.y = replacement.y;
      f.hp = replacement.hp;
    }
    f.avatar = p.avatar;
    f.armor = equippedArmor(p);
    if (['squad', 'quest'].includes(this.w.mode)) f.squadId = o.squadId;
    this.w.players.push(f);
    c.send('identity', { id: p.id, room: this.roomId });
    c.send('snapshot', this.w);
  }
  async onLeave(c: Client, consented: boolean) {
    const id = this.joinIds.get(c.sessionId);
    if (!id) return;
    const p = this.w.players.find((p) => p.id === id);
    if (!p) return;
    if (this.w.mode !== 'quest') await this.lock();
    p.bot = true;
    this.inputs.delete(id);
    let reconnected: Client | undefined;
    if (!consented) {
      try {
        reconnected = await this.allowReconnection(c, 30);
        await recheckRoomSession(this, c, reconnected);
        if (this.maxClients > 1) await assertHumanBand(p.id, this.metadata.ageBand);
        if (this.w.mode === 'quest') {
          const squad = await db
            .prepare('SELECT members FROM squads WHERE id=?')
            .get(this.metadata.squadId);
          if (!squad || !JSON.parse(squad.members).includes(p.id))
            throw Error('Squad membership changed');
        }
        p.bot = false;
        reconnected.send('snapshot', this.w);
        if (this.recorded) reconnected.send('result', { matchId: this.roomId });
        return;
      } catch {
        reconnected?.leave(4001, 'Session or membership changed');
        /* bot retains the slot */
      }
    }
    forgetClientSession(this, c);
  }
  onDispose() {
    forgetRoomSessions(this);
    unregisterLive(this.roomId);
  }
  update() {
    if (this.w.finished) {
      if (!this.recorded && !this.saving && Date.now() >= this.retryAt) void this.settle();
      return;
    }
    if (this.recorded) return;
    this.elapsed += 1 / 30;
    // Both tournament entrants are here: no need to keep waiting.
    if (this.tournament && this.w.players.length >= 2)
      this.elapsed = Math.max(this.elapsed, this.waitFor);
    if (this.elapsed < this.waitFor && this.w.mode !== 'tutorial') {
      this.broadcast('waiting', { seconds: Math.ceil(this.waitFor - this.elapsed) });
      return;
    }
    if (!this.locked && this.w.mode !== 'quest') void this.lock();
    const count = this.w.mode === 'squad' ? 8 : this.w.mode === 'quest' ? 4 : 2;
    while (this.w.players.length < count) {
      const n = this.w.players.length;
      const team =
        this.w.mode === 'squad'
          ? this.w.players.filter((p) => p.team === 0).length < 4
            ? 0
            : 1
          : this.w.mode === 'quest'
            ? 0
            : 1;
      const f = fighter(
        'bot' + n,
        ['Dawit', 'Selam', 'Tewodros', 'Makeda', 'Yared', 'Hana', 'Ezana', 'Almaz'][n] + ' · AI',
        team,
        true,
        n % 4,
        ['duel', 'tutorial'].includes(this.w.mode)
          ? 'guardian'
          : this.roleOrders[team][this.w.players.filter((q) => q.team === team).length % 4],
      );
      if (this.w.mode === 'tutorial') {
        f.x = 700;
        f.y = 350;
      }
      this.w.players.push(f);
    }
    // Training dummy demonstrates damage without attacking the trainee.
    const training = this.w.mode === 'tutorial' ? this.w.players.filter((p) => p.bot) : [];
    for (const p of training) {
      p.bot = false;
      this.inputs.set(p.id, {
        seq: this.w.tick,
        x: 0,
        y: 0,
        aim: Math.PI,
        attack: false,
        block: false,
        dodge: false,
        ability: false,
        interact: false,
      });
    }
    if (this.w.demo && this.w.mode === 'duel') {
      const bot = this.w.players.find((p) => p.bot);
      if (bot) bot.hp = Math.min(bot.hp, 72);
    }
    step(this.w, this.inputs);
    for (const e of this.w.events) {
      const key = `${e.tick}:${e.kind}:${e.actor}:${e.x}:${e.y}`;
      if (!this.loggedEvents.has(key)) {
        this.loggedEvents.add(key);
        this.eventLog.push(e);
      }
    }
    if (this.eventLog.length > 5000) this.eventLog.splice(0, this.eventLog.length - 5000);
    for (const p of training) p.bot = true;
    if (this.w.finished) void this.settle();
    if (this.w.tick % 2 === 0 || this.w.finished) {
      this.broadcast('snapshot', this.w);
      publishSnapshot(this.roomId, this.w);
    }
  }
  /** The tournament entrant who won: the winning human, otherwise the absent or AI opponent. */
  async tournamentWinner() {
    const t = this.tournament!;
    const human = this.w.players.find((p) => !p.id.startsWith('bot'));
    const seat = await tournamentSeat(t.id, t.key, human?.id ?? '').catch(() => null);
    if (!seat) return;
    const entrants = [seat.match.a!, seat.match.b!];
    const winner = this.w.players.find((p) => p.team === this.w.winner && entrants.includes(p.id));
    if (winner) return winner.id;
    const present = this.w.players.map((p) => p.id);
    return entrants.find((id) => !present.includes(id)) ?? entrants[0];
  }
  async settle() {
    if (this.saving || this.recorded) return;
    this.saving = true;
    this.broadcast('saving', { status: 'pending' });
    try {
      await recordResult(this.roomId, { ...this.w, events: this.eventLog }, this.started);
      this.recorded = true;
      this.broadcast('result', { matchId: this.roomId, saved: true });
      if (this.w.mode !== 'tutorial')
        for (const f of this.w.players.filter((p) => !p.id.startsWith('bot')))
          void notify(
            f.id,
            'result',
            `${f.team === this.w.winner ? 'Victory' : 'Defeat'} saved: ${MODE_LABELS[this.w.mode] ?? 'match'} result hashed for your chronicle.`,
            { matchId: this.roomId },
          ).catch(() => {});
      if (this.tournament) {
        const winner = await this.tournamentWinner();
        if (winner)
          await reportTournamentMatch(this.tournament.id, this.tournament.key, winner, this.roomId);
      }
      this.clock.setTimeout(() => {
        void this.disconnect();
      }, 60000);
    } catch {
      this.retryAt = Date.now() + 3000;
      this.broadcast('saving', {
        status: 'retrying',
        message: 'Saving progress. Please stay connected.',
      });
    } finally {
      this.saving = false;
    }
  }
}
