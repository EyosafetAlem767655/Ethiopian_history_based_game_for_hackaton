import { assertHumanBand, readAvatar } from './customization';
import { ageBands } from '../../../packages/shared/src/customization';
import { Room, type Client } from '@colyseus/core';
import { z } from 'zod';
import {
  inputSchema,
  fighter,
  shuffledRoles,
  type Input,
  type World,
  type GameEvent,
} from '../../../packages/shared/src/game';
import { campaignWorld, stepCampaign, equipCampaign } from '../../../packages/shared/src/campaign';
import { MISSIONS, missionEligibility } from '../../../packages/shared/src/missions';
import { PROTOCOL_VERSION } from '../../../packages/shared/src/presentation';
import {
  authenticate,
  campaignProgress,
  db,
  recordResult,
  saveProfile,
  type Profile,
} from './store';
export class CampaignRoom extends Room {
  maxMessagesPerSecond = 80;
  w!: World;
  inputs = new Map<string, Input>();
  ids = new Map<string, string>();
  elapsed = 0;
  recorded = false;
  saving = false;
  retryAt = 0;
  started = new Date().toISOString();
  events: GameEvent[] = [];
  seen = new Set<string>();
  roles = shuffledRoles();
  onCreate(o: {
    ageBand?: string;
    missionId: number;
    demo: boolean;
    squadId?: string;
    protocol: number;
  }) {
    const id = z.number().int().min(1).max(15).parse(o.missionId);
    if (id <= 5) this.roles = ['guardian', 'spear', 'archer', 'rider'];
    this.w = campaignWorld(id, !!o.demo);
    this.maxClients = o.squadId && id !== 4 && ageBands.includes(o.ageBand as any) ? 4 : 1;
    this.setMetadata({
      missionId: id,
      demo: !!o.demo,
      squadId: o.squadId ?? '',
      protocol: PROTOCOL_VERSION,
      ageBand: o.ageBand ?? 'solo',
    });
    if (!o.squadId) void this.setPrivate(true);
    this.onMessage('input', (c, data) => {
      const parsed = inputSchema.safeParse(data),
        id = this.ids.get(c.sessionId);
      if (!parsed.success || !id || parsed.data.seq <= (this.inputs.get(id)?.seq ?? -1)) return;
      this.inputs.set(id, parsed.data);
    });
    let accumulator = 0;
    this.setSimulationInterval((delta) => {
      accumulator += Math.min(delta, 250);
      while (accumulator >= 1000 / 30) {
        accumulator -= 1000 / 30;
        this.update();
      }
    }, 1000 / 30);
  }
  async onAuth(
    _c: Client,
    o: {
      token: string;
      protocol: number;
      squadId?: string;
    },
  ) {
    if (o.protocol !== PROTOCOL_VERSION)
      throw Error('Your game version is outdated. Refresh this page.');
    const p = await authenticate(o.token);
    if (this.maxClients > 1) await assertHumanBand(p.id, this.metadata.ageBand);
    Object.assign(p, { avatar: await readAvatar(p.id) });
    if (!!p.demo !== this.w.demo) throw Error('Demo and normal journeys cannot mix');
    if (this.w.finished) throw Error('This mission has ended');
    if (this.w.players.some((f) => f.id === p.id))
      throw Error('Already participating in this mission');
    const blocked = missionEligibility(
      await campaignProgress(p.id),
      this.w.campaign!.missionId,
      this.w.demo,
    );
    if (blocked) throw Error(blocked);
    if (this.metadata.squadId) {
      const s = (await db
        .prepare('SELECT members FROM squads WHERE id=? AND demo=?')
        .get(this.metadata.squadId, p.demo)) as any;
      if (!s || !JSON.parse(s.members).includes(p.id) || o.squadId !== this.metadata.squadId)
        throw Error('Squad membership required');
    }
    return p;
  }
  async onJoin(
    c: Client,
    o: {
      hero?: number;
    },
    auth: Profile,
  ) {
    const p = auth ?? (c.auth as Profile);
    this.ids.set(c.sessionId, p.id);
    const replacement = this.w.players.find((f) => f.bot && f.id.startsWith('bot') && f.team === 0);
    if (replacement) this.w.players = this.w.players.filter((f) => f.id !== replacement.id);
    const f = equipCampaign(
      fighter(
        p.id,
        p.name,
        0,
        false,
        Math.max(0, Math.min(3, Math.trunc(Number(o.hero) || 0))),
        replacement?.role ?? this.roles[this.w.players.filter((f) => f.team === 0).length % 4],
      ),
      this.w,
    );
    if (replacement) {
      f.x = replacement.x;
      f.y = replacement.y;
      f.hp = replacement.hp;
    }
    f.avatar = p.avatar;
    this.w.players.push(f);
    const progress = await campaignProgress(p.id);
    f.prestige = progress.honor + (progress.contribution ?? 0);
    p.hero = f.hero;
    await db.prepare('UPDATE profiles SET hero=? WHERE id=?').run(p.hero, p.id);
    c.send('identity', { id: p.id, room: this.roomId });
    c.send('snapshot', this.w);
  }
  async onLeave(c: Client, consented: boolean) {
    const id = this.ids.get(c.sessionId),
      p = this.w.players.find((p) => p.id === id);
    if (!p) return;
    this.inputs.delete(p.id);
    p.bot = true;
    if (!consented)
      try {
        const next = await this.allowReconnection(c, 30);
        if (this.maxClients > 1) await assertHumanBand(p.id, this.metadata.ageBand);
        p.bot = false;
        next.send('snapshot', this.w);
        if (this.recorded) next.send('result', { matchId: this.roomId });
      } catch {
        /* retained AI substitution */
      }
  }
  update() {
    if (this.w.finished) {
      if (!this.recorded && !this.saving && Date.now() >= this.retryAt) void this.settle();
      return;
    }
    if (this.recorded) return;
    this.elapsed += 1 / 30;
    if (this.elapsed < 2) {
      this.broadcast('waiting', { seconds: Math.ceil(2 - this.elapsed) });
      return;
    }
    const m = MISSIONS[this.w.campaign!.missionId - 1];
    const party = m.kind === 'joust' ? 1 : 4;
    while (this.w.players.filter((p) => p.team === 0).length < party) {
      const n = this.w.players.filter((p) => p.team === 0).length;
      this.w.players.push(
        equipCampaign(
          fighter(
            'bot' + n,
            ['Selam', 'Dawit', 'Makeda', 'Ezana'][n] + ' · AI',
            0,
            true,
            n % 4,
            this.roles[n],
          ),
          this.w,
        ),
      );
    }
    stepCampaign(this.w, this.inputs);
    for (const e of this.w.events) {
      const key = `${e.tick}:${e.kind}:${e.actor}:${e.x}:${e.y}`;
      if (!this.seen.has(key)) {
        this.seen.add(key);
        this.events.push(e);
      }
    }
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    if (this.w.finished) void this.settle();
    if (this.w.tick % 2 === 0 || this.w.finished) this.broadcast('snapshot', this.w);
  }
  async settle() {
    if (this.saving || this.recorded) return;
    this.saving = true;
    this.broadcast('saving', { status: 'pending' });
    try {
      await recordResult(this.roomId, { ...this.w, events: this.events }, this.started);
      this.recorded = true;
      this.broadcast('result', { matchId: this.roomId, saved: true });
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
