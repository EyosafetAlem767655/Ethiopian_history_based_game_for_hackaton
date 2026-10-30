import {
  world,
  fighter,
  step,
  botInput,
  damage,
  event,
  angleDiff,
  wall,
  type World,
  type Fighter,
  type Input,
  DT,
} from './game';
import { MISSIONS, missionGeometry, type MissionDefinition } from './missions';
export interface Marker {
  id: string;
  x: number;
  y: number;
  label: string;
  kind:
    | 'ring'
    | 'clue'
    | 'seal'
    | 'captive'
    | 'mirror'
    | 'banner'
    | 'base'
    | 'checkpoint'
    | 'beacon';
  done: boolean;
  value?: number;
  hold?: number;
}
export interface CampaignState {
  version: 1;
  missionId: number;
  biome: MissionDefinition['biome'];
  mounted: boolean;
  boss: boolean;
  objective: string;
  messageId: number;
  markers: Marker[];
  sequence: number[];
  entered: number[];
  clues: number;
  wave: number;
  spawned: number;
  round: number;
  roundTick: number;
  throws: Record<string, number>;
  passScores: number[];
  joust: Record<string, { damageStart: number; defense: number; control: number }>;
  escort: number;
  carrier: string;
  captures: number;
  revives: Record<string, number>;
  credited: string[];
  goal: number;
  seed: number;
  mirrorTargets: number[];
  mirrorRound: number;
  honor: number;
  shielded: boolean;
}
export function emptyInput(seq = 0): Input {
  return {
    seq,
    x: 0,
    y: 0,
    aim: 0,
    attack: false,
    block: false,
    dodge: false,
    ability: false,
    interact: false,
  };
}
export function sequenceFor(seed: number, length = 4) {
  const result: number[] = [];
  let n = seed >>> 0;
  while (result.length < length) {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    const value = (n >>> 16) % 4;
    if (result.at(-1) !== value) result.push(value);
  }
  return result;
}
const symbols = ['Sun', 'Diamond', 'Moon', 'Star'];
export function guide(w: World, text: string) {
  const c = w.campaign!;
  if (c.objective !== text) {
    c.objective = text;
    c.messageId++;
    event(w, 'objective', 0, 0, undefined, undefined, text);
  }
}
function honor(w: World, p: Fighter | undefined, key: string, amount = 20) {
  const c = w.campaign!;
  if (!p || c.credited.includes(key)) return;
  c.credited.push(key);
  p.honor = (p.honor ?? 0) + amount;
  p.contribution += amount;
  c.honor += amount;
  event(w, 'honor', p.x, p.y, p.id, amount, key);
}
function marker(id: string, x: number, y: number, label: string, kind: Marker['kind']): Marker {
  return { id, x, y, label, kind, done: false };
}
export function campaignWorld(id: number, demo: boolean, seed = Date.now()): World {
  const m = MISSIONS.find((m) => m.id === id);
  if (!m) throw Error('Unknown mission');
  const w = world('campaign', demo);
  w.geometry = missionGeometry(m);
  w.time = demo ? 240 : m.minutes * 60 + 180;
  if (m.kind === 'conquest') w.time = demo ? 120 : 180;
  w.wind = m.biome === 'wind' ? { x: 0, y: demo ? 35 : 65 } : undefined;
  w.monsterDamage = 0.6 + 0.4 * missionTier(id);
  const c: CampaignState = {
    version: 1,
    missionId: id,
    biome: m.biome,
    mounted: m.mounted,
    boss: false,
    objective: m.guide,
    messageId: 1,
    markers: [],
    sequence: sequenceFor(seed, demo ? 4 : 6),
    entered: [],
    clues: 0,
    wave: 0,
    spawned: 0,
    round: 0,
    roundTick: 0,
    throws: {},
    passScores: [0, 0],
    joust: {},
    escort: 0,
    carrier: '',
    captures: 0,
    revives: {},
    credited: [],
    goal: demo ? 1 : 3,
    seed,
    mirrorTargets: [1, 2, 3],
    mirrorRound: 0,
    honor: 0,
    shielded: false,
  };
  w.campaign = c;
  w.phase = m.kind;
  const W = w.geometry.width,
    H = w.geometry.height;
  if (m.kind === 'ride')
    c.markers = [
      [330, 230],
      [600, 170],
      [950, 230],
      [1000, 540],
      [650, 620],
      [240, 550],
    ].map(([x, y], n) => marker('ring' + n, x, y, 'Ring ' + (n + 1), 'ring'));
  if (['landmarks', 'beacons'].includes(m.kind))
    c.markers = [
      [190, 180],
      [W - 180, 170],
      [W - 190, H - 170],
      [220, H - 180],
    ].map(([x, y], n) => marker('clue' + n, x, y, symbols[n], 'clue'));
  if (m.kind === 'symbols')
    c.markers = [420, 540, 660, 780].map((x, n) =>
      marker('pillar' + n, x, 170, symbols[n], 'seal'),
    );
  if (m.kind === 'artifacts')
    c.markers = [
      [190, 170],
      [W - 180, 180],
      [W - 200, H - 180],
    ].map(([x, y], n) => marker('artifact' + n, x, y, 'Royal seal ' + (n + 1), 'seal'));
  if (m.kind === 'rescue')
    c.markers = [
      [450, 170],
      [W - 200, 190],
      [W - 220, H - 180],
    ].map(([x, y], n) => marker('captive' + n, x, y, 'Hold E · traveler', 'captive'));
  if (m.kind === 'outpost') {
    const ford = marker('outpost', W - 230, H - 190, 'The ford · 100%', 'checkpoint');
    ford.value = 100;
    c.markers = [ford];
  }
  if (m.kind === 'escort')
    c.markers.push(
      ...[
        [500, 450],
        [1000, 450],
        [W - 230, H - 170],
      ].map(([x, y], n) => marker('checkpoint' + n, x, y, 'Checkpoint ' + (n + 1), 'checkpoint')),
    );
  if (m.kind === 'capture')
    c.markers = [
      marker('base', 190, 380, 'Emerald base', 'base'),
      marker('banner', 1020, 380, 'Crimson standard · E', 'banner'),
    ];
  if (m.kind === 'mirrors')
    c.markers = [400, 600, 800].map((x, n) => ({
      ...marker('mirror' + n, x, 330, 'Mirror ' + (n + 1), 'mirror'),
      value: 0,
    }));
  if (m.kind === 'conquest')
    w.zones = [
      { x: 240, y: 380, owner: -1, progress: 0 },
      { x: 600, y: 380, owner: -1, progress: 0 },
      { x: 960, y: 380, owner: -1, progress: 0 },
    ];
  if (m.kind === 'symbols' || m.kind === 'beacons')
    guide(w, `${m.guide} Inscription: ${c.sequence.map((n) => symbols[n]).join(' → ')}.`);
  if (m.kind === 'mirrors')
    guide(
      w,
      `Align the receivers: ${c.mirrorTargets.map((n, i) => `${i + 1}=${['North', 'East', 'South', 'West'][n]}`).join(' · ')}. Press E beside a mirror to turn it.`,
    );
  return w;
}
export function equipCampaign(p: Fighter, w: World) {
  if (w.campaign?.mounted) {
    p.mount = { heading: 0, speed: 0, gait: 0 };
    p.role = 'spear';
  }
  p.kind = 'warrior';
  return p;
}
/** 0 for the first mission … 1 for the last: drives the gradual difficulty ramp. */
export function missionTier(id: number) {
  return Math.max(0, Math.min(1, (id - 1) / 14));
}
function spawn(w: World, count: number, checkpoint?: { x: number; y: number }) {
  const c = w.campaign!,
    tier = missionTier(c.missionId);
  // Early missions send smaller groups; from mission 5 on, encounters keep their full size.
  count = Math.max(1, Math.round(count * Math.min(1, 0.4 + 0.15 * (c.missionId - 1))));
  for (let n = 0; n < count; n++) {
    const index = c.spawned++,
      kind = (['hyena', 'caster', 'warden'] as const)[index % 3];
    const f = fighter(
      'monster-' + index,
      kind === 'hyena' ? 'Eclipse Hyena' : kind === 'caster' ? 'Shadow Caster' : 'Stone Warden',
      1,
      true,
      index % 4,
      kind === 'caster' ? 'archer' : kind === 'warden' ? 'spear' : 'rider',
    );
    f.kind = kind;
    // Monsters toughen gradually: 60% health in the first mission, full health by the last.
    f.hp = Math.round(
      (w.demo ? (kind === 'warden' ? 70 : 40) : kind === 'warden' ? 155 : 85) * (0.6 + 0.4 * tier),
    );
    f.maxHp = f.hp;
    const W = w.geometry!.width,
      H = w.geometry!.height;
    f.x = Math.min(W - 140, Math.max(170, (checkpoint?.x ?? W - 250) + (n % 3) * 65));
    f.y = Math.min(H - 130, Math.max(140, (checkpoint?.y ?? 230) + Math.floor(n / 3) * 85));
    if (wall(f.x, f.y, 20, w.geometry)) {
      const ox = f.x,
        oy = f.y;
      let found = false;
      for (let radius = 40; radius <= 320 && !found; radius += 40)
        for (let side = 0; side < 8; side++) {
          const x = ox + Math.cos((side * Math.PI) / 4) * radius,
            y = oy + Math.sin((side * Math.PI) / 4) * radius;
          if (!wall(x, y, 20, w.geometry)) {
            f.x = x;
            f.y = y;
            found = true;
            break;
          }
        }
    }
    w.players.push(f);
  }
  c.wave++;
  event(w, 'summon', checkpoint?.x ?? 900, checkpoint?.y ?? 250, 'encounter', count);
}
function finish(w: World, win = true) {
  w.finished = true;
  w.winner = win ? 0 : 1;
  w.phase = win ? 'victory' : 'defeat';
  guide(
    w,
    win
      ? 'Honor carries you onward. This mission has been recorded.'
      : 'Your oath endures. Retry this encounter; cleared missions remain saved.',
  );
}
function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function leadAim(p: Fighter, target: Fighter, windY = 0) {
  const dx = target.x - p.x,
    dy = target.y - p.y,
    speed = 620 + (p.mount?.speed ?? 0) * 0.45;
  const a = target.vx ** 2 + target.vy ** 2 - speed ** 2,
    b = 2 * (dx * target.vx + dy * target.vy),
    cc = dx * dx + dy * dy,
    disc = b * b - 4 * a * cc;
  const roots =
    disc >= 0 && Math.abs(a) > 0.001
      ? [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)]
      : [];
  const t = Math.min(1.2, ...roots.filter((n) => n > 0));
  return Math.atan2(dy + target.vy * t - windY * t * t * 0.5, dx + target.vx * t);
}
function botCommand(p: Fighter, w: World): Input {
  const c = w.campaign!,
    m = MISSIONS[c.missionId - 1],
    leader = w.players.find((q) => !q.bot && q.team === 0),
    // Monsters favor warriors over the civilian they guard, so it is not swarmed by everyone.
    threat = (q: Fighter) => distance(p, q) + (q.kind === 'civilian' ? 160 : 0),
    enemies = w.players
      .filter((q) => q.hp > 0 && q.team !== p.team)
      .sort((a, b) => threat(a) - threat(b));
  let tx = enemies[0]?.x ?? w.bossX,
    ty = enemies[0]?.y ?? w.bossY;
  const target = enemies[0];
  let attack = !!target && distance(p, target) < (p.role === 'archer' ? 550 : 135),
    interact = false;
  if (p.kind === 'civilian') {
    // Holds the standard in place and only swings at monsters that come close.
    tx = p.x;
    ty = p.y;
    attack = !!target && distance(p, target) < 120;
  } else if (p.team === 0) {
    const down = w.players.find((q) => q.team === 0 && q.hp <= 0 && q.kind !== 'civilian');
    if (down) {
      tx = down.x;
      ty = down.y;
      interact = distance(p, down) < 85;
      attack = false;
    } else if (!target && !c.boss) {
      tx = (leader?.x ?? 230) + Math.sin(w.tick / 45 + Number(p.id.slice(-1))) * 60;
      ty = (leader?.y ?? 350) + 75;
      attack = false;
    }
  }
  if (m.kind === 'conquest' && (!target || distance(p, target) > 180)) {
    const zone = w.zones[(Number(p.id.replace(/\D/g, '')) || 0) % 3];
    tx = zone.x;
    ty = zone.y;
  }
  if (m.kind === 'outpost' && p.team === 1 && (!target || distance(p, target) > 220)) {
    tx = c.markers[0].x;
    ty = c.markers[0].y;
  }
  if (m.kind === 'joust') {
    tx = p.team === 0 ? 1000 : 200;
    ty = p.team === 0 ? 300 : 430;
    attack = distance(p, w.players.find((q) => q.team !== p.team) ?? p) < 350;
  }
  if (c.boss && !target) {
    attack = distance(p, { x: w.bossX, y: w.bossY }) < (p.role === 'archer' ? 550 : 150);
  }
  const dx = tx - p.x,
    dy = ty - p.y,
    d = Math.hypot(dx, dy),
    reach = interact ? 45 : target ? (p.role === 'archer' ? 230 : 65) : c.boss ? 90 : 40;
  let x = d > reach ? dx / (d || 1) : 0,
    y = d > reach ? dy / (d || 1) : 0;
  const blocked = w.geometry!.obstacles.find(
    (o) => p.x > o.x - 50 && p.x < o.x + o.w + 50 && p.y > o.y - 50 && p.y < o.y + o.h + 50,
  );
  if (blocked) {
    x = p.x < blocked.x + blocked.w / 2 ? -1 : 1;
    y = p.y < blocked.y + blocked.h / 2 ? -1 : 1;
  }
  return {
    seq: w.tick,
    x,
    y,
    aim:
      p.mount && target
        ? leadAim(p, target, w.wind?.y ?? 0)
        : Math.atan2((target?.y ?? ty) - p.y, (target?.x ?? tx) - p.x),
    attack:
      attack &&
      w.tick %
        (p.team === 1
          ? // Early-mission monsters strike up to 60% less often; the last mission is full speed.
            Math.round(
              (p.kind === 'caster' ? 48 : p.kind === 'warden' ? 45 : w.demo ? 30 : 24) *
                (1 + 0.6 * (1 - missionTier(c.missionId))),
            )
          : p.kind === 'civilian'
            ? 54 // The standard-bearer fights back, but swings rarely.
            : 5) ===
        0,
    block: !!target && target.attack > 0.1 && w.tick % 8 === 0,
    dodge: w.telegraph === 'shockwave' && w.tick % 25 === 0,
    ability: p.team === 0 && attack && w.tick % 100 === 0,
    interact,
  };
}
export function stepCampaign(w: World, humanInputs: Map<string, Input>, dt = DT) {
  if (w.finished) return;
  const c = w.campaign!,
    m = MISSIONS[c.missionId - 1];
  const inputs = new Map(humanInputs);
  if (c.wave === 0) {
    if (
      [
        'oath',
        'rescue',
        'capture',
        'outpost',
        'escort',
        'guardian',
        'artifacts',
        'beacons',
      ].includes(m.kind)
    )
      // The oath opens with a single monster; others arrive one at a time (see the oath step).
      spawn(
        w,
        m.kind === 'oath' || m.kind === 'outpost' ? 1 : w.demo ? 2 : 4,
        m.kind === 'oath'
          ? { x: 1000, y: 380 }
          : m.kind === 'outpost'
            ? { x: 230, y: 200 }
            : undefined,
      );
    if (m.kind === 'outpost') {
      // The defenders start at the ford; the waves march in from the far corner.
      const ford = c.markers[0];
      for (const [n, p] of w.players.filter((p) => p.team === 0).entries()) {
        p.x = ford.x - 70 - n * 30;
        p.y = ford.y - 20 + n * 25;
      }
    }
    if (m.kind === 'conquest') {
      while (w.players.filter((p) => p.team === 1).length < 4) {
        const n = w.players.length,
          f = fighter(
            'rival' + n,
            'Crimson Rider · AI',
            1,
            true,
            n % 4,
            (['guardian', 'spear', 'archer', 'rider'] as const)[n % 4],
          );
        w.players.push(f);
      }
      c.wave = 1;
    }
    if (m.kind === 'joust') {
      const rival = equipCampaign(
        fighter('joust-rival', 'The Wind Challenger', 1, true, 3, 'spear'),
        w,
      );
      rival.x = 1000;
      rival.y = 430;
      rival.mount!.heading = Math.PI;
      rival.hp = 1000;
      rival.maxHp = 1000;
      w.players.push(rival);
      for (const p of w.players) c.joust[p.id] = { damageStart: p.damage, defense: 0, control: 0 };
      for (const p of w.players.filter((p) => p.team === 0)) {
        p.hp = 1000;
        p.maxHp = 1000;
      }
      c.wave = 1;
    }
    if (m.kind === 'throne') {
      c.boss = true;
      w.phase = 'challenge';
      w.bossHp = w.demo ? 140 : 700;
      w.bossMax = w.bossHp;
      w.challengeOrder = [...w.players]
        .filter((p) => p.team === 0)
        .sort((a, b) => b.contribution + (b.prestige ?? 0) - a.contribution - (a.prestige ?? 0))
        .map((p) => p.id);
      c.wave = 1;
    }
    if (m.kind === 'oath') {
      const npc = fighter('trainee', 'Young Standard-bearer', 0, true, 1);
      npc.kind = 'civilian';
      npc.x = 600;
      npc.y = 380;
      npc.hp = 300;
      npc.maxHp = 300;
      w.players.push(npc);
    }
  }
  for (const p of w.players) {
    // The oath's standard-bearer defends itself; other civilians are escorted and stay passive.
    if (p.bot)
      inputs.set(
        p.id,
        p.kind === 'civilian' && m.kind !== 'oath' ? emptyInput(w.tick) : botCommand(p, w),
      );
    if (m.kind === 'joust' && (c.throws[p.id] ?? -1) === c.round) {
      const i = inputs.get(p.id);
      if (i) inputs.set(p.id, { ...i, attack: false });
    }
    if (p.hp <= 0 && p.team === 0 && !c.boss) {
      p.respawn = Math.max(0, p.respawn);
    }
  }
  c.shielded =
    c.boss &&
    (m.kind === 'guardian'
      ? w.telegraph !== 'vulnerable'
      : w.phase === 'eclipse' && c.round < (w.demo ? 2 : 3));
  const before = new Map(w.players.map((p) => [p.id, p.attackId])),
    oldPhase = w.phase;
  step(w, inputs, dt);
  if (m.kind === 'joust') {
    for (const p of w.players) if (p.attackId !== (before.get(p.id) ?? 0)) c.throws[p.id] = c.round;
    for (const p of w.players)
      if (p.mount && p.mount.speed > 100 && p.mount.speed < 400)
        c.joust[p.id].control = Math.min(160 / 6, c.joust[p.id].control + dt * 3);
    for (const e of w.events.filter((e) => e.tick === w.tick && e.kind === 'block')) {
      const attacker = w.players.find((p) => p.id === e.actor),
        defender = w.players.find(
          (p) => p.team !== attacker?.team && Math.hypot(p.x - e.x, p.y - e.y) < 55,
        );
      if (defender) c.joust[defender.id].defense = 40;
    }
  }
  // Monster differences are authoritative: wardens telegraph an area slam, casters use swept projectiles.
  for (const p of w.players.filter((p) => p.hp > 0 && p.kind === 'warden')) {
    const beat = w.tick % 150;
    if (beat === 100) event(w, 'danger', p.x, p.y, p.id, 115, 'Stone slam');
    if (beat === 130)
      for (const t of w.players.filter((t) => t.team !== p.team && distance(p, t) < 115))
        damage(w, p, t, w.demo ? 10 : 25);
  }
  for (const p of w.players.filter((p) => p.hp > 0 && p.team === 0)) {
    const i = inputs.get(p.id);
    if (!i?.interact) continue;
    const down = w.players
      .filter((q) => q.id !== p.id && q.team === 0 && q.hp <= 0 && distance(p, q) < 85)
      .sort((a, b) => distance(p, a) - distance(p, b))[0];
    if (down) {
      c.revives[down.id] = (c.revives[down.id] ?? 0) + dt;
      if (c.revives[down.id] >= (w.demo ? 1 : 2)) {
        down.hp = 60;
        down.invulnerable = 2;
        c.revives[down.id] = 0;
        honor(w, p, 'revive-' + down.id);
        guide(w, `${down.name} is back on their feet. Protect one another.`);
      }
    }
  }
  const humans = w.players.filter((p) => !p.bot && p.team === 0);
  // Catch your breath between fights: warriors recover when no monster is near. Generous in
  // early missions (~8 hp/s), tapering to 2 hp/s by the last, never during the boss.
  if (!c.boss && m.kind !== 'joust') {
    const recovery = (2 + 6 * (1 - missionTier(c.missionId))) * dt;
    for (const p of w.players)
      if (
        p.team === 0 &&
        p.hp > 0 &&
        p.hp < (p.maxHp ?? 100) &&
        !w.players.some((q) => q.team === 1 && q.hp > 0 && distance(p, q) < 320)
      )
        p.hp = Math.min(p.maxHp ?? 100, p.hp + recovery);
  }
  for (const p of humans) {
    const i = inputs.get(p.id);
    if (!i?.interact || p.hp <= 0) {
      p.lastPillar = -1;
      continue;
    }
    const defeated = w.players.find((q) => q.team === 1 && q.hp <= 0 && distance(p, q) < 65);
    if (defeated) honor(w, p, 'mercy-' + defeated.id, 10);
    const near = c.markers
      .filter((a) => distance(p, a) < 82)
      .sort((a, b) => distance(p, a) - distance(p, b))[0];
    if (!near) continue;
    if (near.kind === 'captive' && !near.done) {
      near.hold = (near.hold ?? 0) + dt;
      if (near.hold >= (w.demo ? 1 : 3)) {
        near.done = true;
        honor(w, p, near.id);
        for (const ally of w.players.filter(
          (q) => q.team === 0 && q.hp > 0 && distance(q, near) < 200,
        )) {
          ally.hp = Math.min(ally.maxHp ?? 100, ally.hp + 30);
          ally.stamina = Math.min(100, ally.stamina + 30);
        }
        event(w, 'rescue', near.x, near.y, p.id, 20, 'Traveler rescued');
        guide(
          w,
          `${c.markers.filter((a) => a.kind === 'captive' && a.done).length} travelers rescued. Search the next guarded path.`,
        );
      }
    }
    if (m.kind === 'throne' && w.phase === 'eclipse' && near.kind === 'beacon' && !near.done) {
      near.hold = (near.hold ?? 0) + dt;
      if (near.hold >= 1) {
        near.done = true;
        honor(w, p, 'ward-' + c.round + '-' + near.id, 5);
        event(w, 'artifact', near.x, near.y, p.id, 5, 'Crown ward broken');
      }
    }
    if (near.kind === 'clue' && !near.done) {
      near.done = true;
      c.clues++;
      honor(w, p, 'read-' + near.id, 5);
      guide(
        w,
        `Inscription ${c.clues}/4: ${c.sequence.map((n) => symbols[n]).join(' → ')}. ${c.clues === 4 ? 'Return to the gate seals.' : 'Find the other landmarks.'}`,
      );
    }
    if (near.kind === 'seal' && m.kind === 'artifacts' && !near.done) {
      near.done = true;
      honor(w, p, near.id);
      event(w, 'artifact', near.x, near.y, p.id, 20, 'Royal artifact');
    }
    if (
      ((near.kind === 'seal' && m.kind === 'symbols') ||
        (near.kind === 'beacon' && m.kind !== 'throne')) &&
      p.interactCooldown <= 0 &&
      p.lastPillar !== c.markers.indexOf(near)
    ) {
      p.lastPillar = c.markers.indexOf(near);
      p.interactCooldown = 0.65;
      const index = Number(near.id.replace(/\D/g, ''));
      if (index === c.sequence[c.entered.length]) {
        c.entered.push(index);
        near.done = true;
        honor(w, p, 'symbol-' + c.round + '-' + c.entered.length, 5);
      } else {
        c.entered = [];
        for (const a of c.markers) a.done = false;
      }
      event(
        w,
        'pillar',
        near.x,
        near.y,
        p.id,
        undefined,
        index === c.entered.at(-1) ? 'Correct' : 'Sequence reset',
      );
      guide(
        w,
        `${c.entered.length}/${c.sequence.length} symbols restored. Inscription: ${c.sequence.map((n) => symbols[n]).join(' → ')}.`,
      );
    }
    if (
      near.kind === 'mirror' &&
      p.interactCooldown <= 0 &&
      p.lastPillar !== c.markers.indexOf(near)
    ) {
      p.interactCooldown = 0.45;
      p.lastPillar = c.markers.indexOf(near);
      near.value = ((near.value ?? 0) + 1) % 4;
      event(
        w,
        'mirror',
        near.x,
        near.y,
        p.id,
        undefined,
        ['North', 'East', 'South', 'West'][near.value],
      );
    }
    if (near.kind === 'banner' && !c.carrier) {
      c.carrier = p.id;
      guide(w, 'You carry the crimson standard. Return it to the emerald base.');
    }
    // Mercy is optional, explicitly chosen beside a defeated foe and credited once.
  }
  const aliveEnemies = () => w.players.filter((p) => p.team === 1 && p.hp > 0);
  if (m.kind === 'oath') {
    const trainee = w.players.find((p) => p.id === 'trainee')!;
    if (trainee.hp <= 0) {
      finish(w, false);
      return;
    }
    const duration = w.demo ? 60 : 180;
    if (!aliveEnemies().length && w.tick / 30 >= duration) {
      for (const p of humans.filter((p) => p.damage > 0))
        honor(w, p, 'protect-trainee-' + p.id, 40);
      finish(w);
    } else if (
      // One monster at a time on a timer, never more than two on the field at once.
      w.tick / 30 >= c.wave * (w.demo ? 12 : 20) &&
      w.tick / 30 < duration &&
      aliveEnemies().length < 2
    ) {
      spawn(w, 1, { x: c.wave % 2 ? 220 : 1000, y: c.wave % 3 === 0 ? 200 : 500 });
      guide(
        w,
        `A new monster approaches (${c.wave}). Keep the standard-bearer alive through the ${duration}-second oath.`,
      );
    }
  }
  if (m.kind === 'ride') {
    const next = c.markers.find((a) => !a.done),
      p = humans[0];
    if (next && p && distance(p, next) < 75 && Math.abs(p.mount?.speed ?? 0) > 30) {
      next.done = true;
      event(w, 'ring', next.x, next.y, p.id);
      guide(
        w,
        `Ring ${c.markers.filter((a) => a.done).length}/6. ${next === c.markers.at(-1) ? 'A fine riding line.' : 'Follow the next golden ring.'}`,
      );
    }
    if (c.markers.every((a) => a.done)) {
      c.round++;
      if (c.round >= (w.demo ? 2 : 5)) finish(w);
      else {
        c.markers.forEach((a) => (a.done = false));
        guide(w, `Lap ${c.round + 1}/${w.demo ? 2 : 5}. Control your turns and keep your line.`);
      }
    }
  }
  if (m.kind === 'joust') {
    c.roundTick += dt;
    if (c.roundTick >= 18) {
      c.round++;
      c.roundTick = 0;
      const hero = humans[0],
        rival = w.players.find((p) => p.id === 'joust-rival')!;
      for (const p of w.players) {
        const stats = c.joust[p.id];
        c.passScores[p.team] +=
          Math.min(100, (Math.max(0, p.damage - stats.damageStart) * 100) / 24) +
          stats.defense +
          stats.control;
        c.joust[p.id] = { damageStart: p.damage, defense: 0, control: 0 };
      }
      w.scores = [...c.passScores];
      if (c.round >= 6) {
        w.scores = c.passScores;
        finish(w, (hero?.damage ?? 0) > 0 && c.passScores[0] >= c.passScores[1]);
      } else {
        for (const p of w.players) {
          p.x = p.team === 0 ? 200 : 1000;
          p.y = p.team === 0 ? 300 : 430;
          p.mount!.heading = p.team === 0 ? 0 : Math.PI;
          p.mount!.speed = 0;
          p.hp = 1000;
        }
        w.projectiles = [];
        guide(
          w,
          `Pass ${c.round + 1}/6. Wind bends a thrown spear. Score ${Math.floor(c.passScores[0])} : ${Math.floor(c.passScores[1])}.`,
        );
      }
    }
  }
  if (['landmarks', 'beacons'].includes(m.kind) && c.clues === 4) {
    c.markers = c.markers.map((a, n) => ({ ...a, kind: 'beacon', id: 'beacon' + n, done: false }));
    c.clues = 5;
    guide(w, `Kindle the gate in this order: ${c.sequence.map((n) => symbols[n]).join(' → ')}.`);
  }
  if (
    ['landmarks', 'symbols', 'beacons'].includes(m.kind) &&
    c.entered.length === c.sequence.length
  ) {
    if (m.kind === 'beacons' && c.wave < 2) {
      c.sequence = [];
      c.entered = [];
      spawn(w, w.demo ? 2 : 6, { x: 900, y: 400 });
      guide(w, 'The watchfires burn. Defend them until the last shadow falls.');
    } else if (m.kind === 'symbols' && ++c.round < (w.demo ? 3 : 5)) {
      c.sequence = sequenceFor(c.seed + c.round, w.demo ? 4 : 6);
      c.entered = [];
      c.markers.forEach((a) => (a.done = false));
      guide(
        w,
        `Seal ${c.round + 1}/${w.demo ? 3 : 5}. Inscription: ${c.sequence.map((n) => symbols[n]).join(' → ')}.`,
      );
    } else if (m.kind !== 'beacons' || !aliveEnemies().length) finish(w);
  }
  if (
    m.kind === 'rescue' &&
    c.markers.filter((a) => a.kind === 'captive').every((a) => a.done) &&
    !aliveEnemies().length
  )
    finish(w);
  if (m.kind === 'artifacts' && c.markers.every((a) => a.done) && !aliveEnemies().length) finish(w);
  if (m.kind === 'outpost') {
    // Hold the ford: monsters standing on it drain its strength; clear every wave to win.
    const ford = c.markers[0],
      waves = 3,
      raiders = aliveEnemies().filter((p) => distance(p, ford) < 95).length;
    if (raiders) ford.value = Math.max(0, (ford.value ?? 100) - raiders * (w.demo ? 3 : 5) * dt);
    ford.label = `The ford · ${Math.ceil(ford.value ?? 0)}%`;
    if ((ford.value ?? 0) <= 0) {
      guide(w, 'The monsters overran the ford. Rally and hold it again.');
      finish(w, false);
      return;
    }
    if (!aliveEnemies().length) {
      if (c.wave >= waves) {
        honor(w, humans[0], 'outpost-held');
        finish(w);
      } else {
        // A short breather, then the next, larger wave.
        c.roundTick += dt;
        if (c.roundTick >= 3) {
          c.roundTick = 0;
          spawn(w, 2, { x: 230, y: c.wave % 2 ? 520 : 200 });
          guide(
            w,
            `Wave ${c.wave} of ${waves} is coming for the ford. Meet them before they reach it.`,
          );
        }
      }
    }
  }
  if (m.kind === 'escort') {
    const released = true;
    if (released) {
      let bearer = w.players.find((p) => p.id === 'bearer');
      if (!bearer) {
        bearer = fighter('bearer', 'Royal Banner Bearer', 0, true, 1);
        bearer.kind = 'civilian';
        bearer.x = 260;
        bearer.y = 380;
        bearer.hp = 180;
        bearer.maxHp = 180;
        w.players.push(bearer);
      }
      if (bearer.hp <= 0) {
        finish(w, false);
        return;
      }
      const points = c.markers.filter((a) => a.kind === 'checkpoint'),
        next = points[c.escort];
      if (
        next &&
        bearer.hp > 0 &&
        w.players.some(
          (p) => p.team === 0 && p.kind !== 'civilian' && p.hp > 0 && distance(p, bearer!) < 180,
        )
      ) {
        const d = distance(bearer, next);
        if (d < 30) {
          next.done = true;
          c.escort++;
          honor(w, humans[0], 'escort-' + c.escort);
          if (c.escort < points.length) {
            spawn(w, w.demo ? 1 : 3, { x: next.x + 120, y: next.y + 200 });
            guide(w, `Checkpoint ${c.escort}/${points.length}. Protect the bearer and advance.`);
          }
        } else if (!aliveEnemies().some((p) => distance(p, bearer!) < 180)) {
          bearer.x += ((next.x - bearer.x) / (d || 1)) * dt * (w.demo ? 100 : 65);
          bearer.y += ((next.y - bearer.y) / (d || 1)) * dt * (w.demo ? 100 : 65);
        }
      }
      if (c.escort === points.length && !aliveEnemies().length) finish(w);
    }
  }
  if (m.kind === 'capture') {
    const carrier = w.players.find((p) => p.id === c.carrier);
    if (carrier && carrier.hp <= 0) c.carrier = '';
    if (carrier && distance(carrier, c.markers[0]) < 90) {
      c.captures++;
      honor(w, carrier, 'capture-' + c.captures);
      c.carrier = '';
      if (c.captures >= c.goal) finish(w);
      else {
        spawn(w, 3, { x: 900, y: 350 });
        guide(w, `${c.captures}/${c.goal} standards recovered. The enemy regroups.`);
      }
    }
  }
  if (m.kind === 'conquest') {
    for (const z of w.zones) {
      const teams = [0, 1].map(
        (t) => w.players.filter((p) => p.team === t && p.hp > 0 && distance(p, z) < 100).length,
      );
      if (teams[0] && !teams[1]) z.progress = Math.max(-3, z.progress - dt);
      if (teams[1] && !teams[0]) z.progress = Math.min(3, z.progress + dt);
      if (z.progress <= -3) z.owner = 0;
      if (z.progress >= 3) z.owner = 1;
      if (z.owner >= 0) w.scores[z.owner] += dt * 2;
    }
    for (const p of w.players.filter((p) => p.hp <= 0)) {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        p.hp = p.maxHp ?? 100;
        p.x = p.team ? 1000 : 200;
        p.y = 380;
        p.invulnerable = 2;
      }
    }
    if (w.time <= 0) finish(w, w.scores[0] >= w.scores[1]);
  }
  if (m.kind === 'mirrors' && c.markers.every((a, n) => a.value === c.mirrorTargets[n])) {
    c.mirrorRound++;
    honor(w, humans[0], 'constellation-' + c.mirrorRound);
    if (c.mirrorRound >= (w.demo ? 1 : 3)) finish(w);
    else {
      c.mirrorTargets = c.mirrorTargets.map((v, n) => (v + n + 1) % 4);
      guide(
        w,
        `Constellation ${c.mirrorRound + 1}/3. Receivers: ${c.mirrorTargets.map((n, i) => `${i + 1}=${['North', 'East', 'South', 'West'][n]}`).join(' · ')}.`,
      );
    }
  }
  if (m.kind === 'guardian') {
    if (!c.boss && !aliveEnemies().length) {
      if (c.wave < (w.demo ? 1 : 3)) {
        spawn(w, 5);
        guide(w, 'A new ward wakes. Watch the stone slam and silence the casters.');
      } else {
        c.boss = true;
        w.phase = 'guardian';
        w.bossHp = w.demo ? 280 : 900;
        w.bossMax = w.bossHp;
        w.bossTimer = 0;
        guide(
          w,
          'The Lion Guardian awakens. Dodge the crimson shockwave and strike during its recovery.',
        );
      }
    }
    if (c.boss && oldPhase === 'guardian' && w.phase === 'challenge') finish(w);
  }
  if (m.kind === 'throne' && w.phase === 'eclipse') {
    if (oldPhase === 'challenge') {
      c.round = 0;
      c.shielded = true;
      c.markers = [
        [300, 180],
        [1000, 180],
        [1000, 600],
        [230, 600],
      ].map(([x, y], n) => marker('ward' + n, x, y, `Crown ward ${n + 1} · hold E`, 'beacon'));
      guide(
        w,
        'The Crown draws strength from four wards. Hold E at each golden ward while your squad holds the King.',
      );
    }
    if (c.markers.length && c.markers.every((a) => a.done) && c.round < (w.demo ? 2 : 3)) {
      c.round++;
      if (c.round < (w.demo ? 2 : 3)) {
        c.markers.forEach((a) => {
          a.done = false;
          a.hold = 0;
        });
        guide(
          w,
          `The outer seal breaks. Dispel ward ring ${c.round + 1}/${w.demo ? 2 : 3}; the King’s magic grows restless.`,
        );
      } else {
        c.shielded = false;
        guide(w, 'Every ward is broken. The Eclipse Crown is exposed. Strike together!');
      }
    }
  }
  if (m.kind === 'throne' && w.phase !== oldPhase)
    guide(
      w,
      w.phase === 'eclipse'
        ? 'The Eclipse Crown awakens. Hold E at the four golden wards to break its protection. Your squad holds the King.'
        : 'The crown is free. Aksumara remembers your fellowship.',
    );
  if (
    humans.length &&
    m.kind !== 'conquest' &&
    w.players.filter((p) => p.team === 0 && p.kind !== 'civilian').every((p) => p.hp <= 0) &&
    !c.boss
  )
    finish(w, false);
  if (w.time <= 0 && m.kind !== 'conquest' && !w.finished) finish(w, false);
}
