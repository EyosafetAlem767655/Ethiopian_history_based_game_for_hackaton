import type { AvatarSpec } from './customization';
import { z } from 'zod';
import { PROTOCOL_VERSION, type Geometry } from './presentation';
import type { CampaignState } from './campaign';
export const WIDTH = 1200,
  HEIGHT = 760,
  DT = 1 / 30;
export const inputSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    x: z.number().min(-1).max(1),
    y: z.number().min(-1).max(1),
    aim: z.number().finite(),
    attack: z.boolean(),
    block: z.boolean(),
    dodge: z.boolean(),
    ability: z.boolean(),
    interact: z.boolean(),
  })
  .strict();
export type Input = z.infer<typeof inputSchema>;
export type Mode = 'tutorial' | 'duel' | 'squad' | 'quest' | 'campaign';
export type Role = 'guardian' | 'spear' | 'archer' | 'rider';
export const ROLES: Role[] = ['guardian', 'spear', 'archer', 'rider'];
export function shuffledRoles(random: () => number = Math.random): Role[] {
  const roles = [...ROLES];
  for (let n = roles.length - 1; n > 0; n--) {
    const j = Math.floor(random() * (n + 1));
    [roles[n], roles[j]] = [roles[j], roles[n]];
  }
  return roles;
}
export interface Fighter {
  avatar?: AvatarSpec;
  mount?: { heading: number; speed: number; gait: number };
  kind?: 'warrior' | 'hyena' | 'caster' | 'warden' | 'civilian';
  honor?: number;
  prestige?: number;
  revived?: number;
  id: string;
  name: string;
  hero: number;
  team: number;
  bot: boolean;
  role: Role;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  hp: number;
  maxHp?: number;
  stamina: number;
  cooldown: number;
  dodge: number;
  invulnerable: number;
  stun: number;
  attack: number;
  attackId: number;
  hits: string[];
  block: boolean;
  seq: number;
  kills: number;
  damage: number;
  contribution: number;
  deaths: number;
  respawn: number;
  ability: number;
  interactCooldown: number;
  lastPillar: number;
  puzzleCredits: number;
}
export interface Projectile {
  kind?: 'arrow' | 'spear' | 'magic';
  id: number;
  owner: string;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
export interface Zone {
  x: number;
  y: number;
  owner: number;
  progress: number;
}
export interface World {
  protocol: number;
  geometry?: Geometry;
  wind?: { x: number; y: number };
  campaign?: CampaignState;
  mode: Mode;
  demo: boolean;
  phase: string;
  time: number;
  tick: number;
  players: Fighter[];
  projectiles: Projectile[];
  zones: Zone[];
  scores: number[];
  artifacts: boolean[];
  puzzle: number[];
  bossHp: number;
  bossMax: number;
  bossX: number;
  bossY: number;
  bossTimer: number;
  telegraph: string;
  winner: number;
  finished: boolean;
  events: GameEvent[];
  champion: string;
  challenger: number;
  challengeOrder: string[];
}
export interface GameEvent {
  tick: number;
  kind: string;
  x: number;
  y: number;
  amount?: number;
  actor?: string;
  text?: string;
}
export const obstacles = [
  { x: 350, y: 240, w: 90, h: 70 },
  { x: 760, y: 450, w: 90, h: 70 },
  { x: 355, y: 480, w: 60, h: 60 },
  { x: 785, y: 220, w: 60, h: 60 },
];
export const artifacts = [
  { x: 180, y: 170 },
  { x: 1020, y: 160 },
  { x: 1040, y: 610 },
];
export const pillars = [
  { x: 420, y: 170 },
  { x: 540, y: 170 },
  { x: 660, y: 170 },
  { x: 780, y: 170 },
];
export const PUZZLE = [2, 0, 3, 1];
export function fighter(
  id: string,
  name: string,
  team = 0,
  bot = false,
  hero = 0,
  role: Role = 'guardian',
): Fighter {
  return {
    id,
    name,
    team,
    bot,
    hero,
    role,
    x: team === 0 ? 230 : 960,
    y: 300 + Math.random() * 150,
    vx: 0,
    vy: 0,
    aim: team ? Math.PI : 0,
    hp: 100,
    stamina: 100,
    cooldown: 0,
    dodge: 0,
    invulnerable: 0,
    stun: 0,
    attack: 0,
    attackId: 0,
    hits: [],
    block: false,
    seq: -1,
    kills: 0,
    damage: 0,
    contribution: 0,
    deaths: 0,
    respawn: 0,
    ability: 0,
    interactCooldown: 0,
    lastPillar: -1,
    puzzleCredits: 0,
  };
}
export function world(mode: Mode, demo: boolean): World {
  return {
    protocol: PROTOCOL_VERSION,
    mode,
    demo,
    phase: mode === 'quest' ? 'artifacts' : mode === 'tutorial' ? 'movement' : 'battle',
    time: mode === 'squad' ? (demo ? 65 : 120) : mode === 'duel' ? 75 : 600,
    tick: 0,
    players: [],
    projectiles: [],
    zones: [
      { x: 240, y: 380, owner: -1, progress: 0 },
      { x: 600, y: 380, owner: -1, progress: 0 },
      { x: 960, y: 380, owner: -1, progress: 0 },
    ],
    scores: [0, 0],
    artifacts: [false, false, false],
    puzzle: [],
    bossHp: 0,
    bossMax: 0,
    bossX: 900,
    bossY: 380,
    bossTimer: 0,
    telegraph: '',
    winner: -1,
    finished: false,
    events: [],
    champion: '',
    challenger: 0,
    challengeOrder: [],
  };
}
export function angleDiff(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
export function inArc(
  a: Pick<Fighter, 'x' | 'y' | 'aim'>,
  b: { x: number; y: number },
  range = 100,
  arc = 1.1,
) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return d > 5 && d < range && Math.abs(angleDiff(Math.atan2(b.y - a.y, b.x - a.x), a.aim)) < arc;
}
export function segmentHit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  r: number,
) {
  const dx = bx - ax,
    dy = by - ay,
    t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx - cx, ay + t * dy - cy) < r;
}
export function wall(x: number, y: number, r = 20, geometry?: Geometry) {
  return (
    x < 60 + r ||
    x > (geometry?.width ?? WIDTH) - 60 - r ||
    y < 80 + r ||
    y > (geometry?.height ?? HEIGHT) - 60 - r ||
    (geometry?.obstacles ?? obstacles).some(
      (o) => x + r > o.x && x - r < o.x + o.w && y + r > o.y && y - r < o.y + o.h,
    )
  );
}
export function move(p: Fighter, i: Input, dt: number, geometry?: Geometry) {
  p.aim = i.aim;
  p.block = i.block && p.stamina > 5 && p.attack <= 0;
  if (p.stun > 0 || p.hp <= 0) return;
  const len = Math.hypot(i.x, i.y) || 1,
    speed =
      (p.block
        ? 85
        : p.kind === 'warden'
          ? 110
          : p.kind === 'hyena'
            ? 245
            : p.role === 'rider'
              ? 240
              : 205) * (geometry?.friction ?? 1);
  if (p.mount) {
    p.x = Math.max(86, Math.min((geometry?.width ?? WIDTH) - 86, p.x));
    p.y = Math.max(106, Math.min((geometry?.height ?? HEIGHT) - 86, p.y));
    const m = p.mount,
      wants = Math.hypot(i.x, i.y) > 0.1;
    if (wants) {
      const desired = Math.atan2(i.y, i.x),
        turn = (3.4 - Math.min(1.7, m.speed / 200)) * dt;
      m.heading += Math.max(-turn, Math.min(turn, angleDiff(desired, m.heading)));
    }
    const target = wants ? (p.block ? 145 : 355) * (geometry?.friction ?? 1) : 0;
    m.speed += (target - m.speed) * Math.min(1, dt * (wants ? 1.6 : 3.5));
    m.gait += (m.speed * dt) / 45;
    p.vx = Math.cos(m.heading) * m.speed;
    p.vy = Math.sin(m.heading) * m.speed;
    if (i.dodge && p.dodge <= 0 && p.stamina >= 25) {
      p.stamina -= 25;
      p.dodge = 1.4;
      p.invulnerable = 0.3;
      m.speed = Math.min(430, m.speed + 90);
    }
    const nx = p.x + p.vx * dt,
      ny = p.y + p.vy * dt;
    if (!wall(nx, p.y, 26, geometry)) p.x = nx;
    else {
      m.speed *= 0.3;
      p.vx = 0;
    }
    if (!wall(p.x, ny, 26, geometry)) p.y = ny;
    else {
      m.speed *= 0.3;
      p.vy = 0;
    }
    return;
  }
  if (i.dodge && p.dodge <= 0 && p.stamina >= 25) {
    p.stamina -= 25;
    p.dodge = 1.1;
    p.invulnerable = 0.28;
    const dx = i.x || i.y ? i.x : Math.cos(p.aim),
      dy = i.x || i.y ? i.y : Math.sin(p.aim),
      length = Math.hypot(dx, dy) || 1;
    p.vx = (dx / length) * 640;
    p.vy = (dy / length) * 640;
  }
  if (p.invulnerable <= 0) {
    const blend = Math.min(1, dt * 12);
    p.vx += ((i.x / Math.max(1, len)) * speed - p.vx) * blend;
    p.vy += ((i.y / Math.max(1, len)) * speed - p.vy) * blend;
  }
  const nx = p.x + p.vx * dt,
    ny = p.y + p.vy * dt;
  if (!wall(nx, p.y, 20, geometry)) p.x = nx;
  else p.vx = 0;
  if (!wall(p.x, ny, 20, geometry)) p.y = ny;
  else p.vy = 0;
}
export function botInput(p: Fighter, w: World): Input {
  const easy = w.demo && p.team === 1;
  const peaceful = w.mode === 'quest' && ['artifacts', 'puzzle'].includes(w.phase);
  let target = w.players
    .filter((q) => q.team !== p.team && q.hp > 0)
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  let tx = target?.x ?? w.bossX,
    ty = target?.y ?? w.bossY;
  if (w.mode === 'squad' && w.tick % 240 < 180) {
    const z = w.zones[(Number(p.id.replace(/\D/g, '')) || 0) % 3];
    tx = z.x;
    ty = z.y;
  }
  if (w.mode === 'quest' && ['artifacts', 'puzzle'].includes(w.phase)) {
    const lead = w.players.find((q) => !q.bot);
    tx = (lead?.x ?? 600) + Math.sin(w.tick / 50 + Number(p.id.slice(-1))) * 55;
    ty = (lead?.y ?? 380) + 60;
  }
  const dx = tx - p.x,
    dy = ty - p.y,
    d = Math.hypot(dx, dy),
    reach = p.role === 'archer' ? 260 : 65;
  let x = d > reach ? dx / (d || 1) : 0,
    y = d > reach ? dy / (d || 1) : 0;
  if (
    (w.geometry?.obstacles ?? obstacles).some(
      (o) => p.x > o.x - 45 && p.x < o.x + o.w + 45 && p.y > o.y - 45 && p.y < o.y + o.h + 45,
    )
  ) {
    y = p.y < 380 ? -1 : 1;
    x *= 0.25;
  }
  return {
    seq: w.tick,
    x,
    y,
    aim: Math.atan2(dy, dx),
    attack: !peaceful && d < (p.role === 'archer' ? 550 : 125) && w.tick % (easy ? 27 : 5) === 0,
    block: !easy && !!target && target.attack > 0 && w.tick % 3 === 0,
    dodge: w.telegraph !== '' && w.tick % 24 === 0,
    ability: !peaceful && !easy && d < 160 && w.tick % 90 === 0,
    interact: false,
  };
}
export function event(
  w: World,
  kind: string,
  x: number,
  y: number,
  actor?: string,
  amount?: number,
  text?: string,
) {
  w.events.push({ tick: w.tick, kind, x, y, actor, amount, text });
  if (w.events.length > 80) w.events.shift();
}
export function damage(w: World, p: Fighter, t: Fighter, amount: number) {
  if (t.hp <= 0 || t.invulnerable > 0) return;
  const blocked = t.block && Math.abs(angleDiff(Math.atan2(p.y - t.y, p.x - t.x), t.aim)) < 1.2;
  if (blocked) {
    t.stamina = Math.max(0, t.stamina - 15);
    amount = 3;
  }
  t.hp = Math.max(0, t.hp - amount);
  p.damage += amount;
  p.contribution += amount;
  const a = Math.atan2(t.y - p.y, t.x - p.x);
  t.vx += Math.cos(a) * 180;
  t.vy += Math.sin(a) * 180;
  t.stun = 0.1;
  event(w, blocked ? 'block' : 'hit', t.x, t.y, p.id, amount);
  if (t.hp <= 0) {
    p.kills++;
    p.contribution += 50;
    t.deaths++;
    t.respawn = 5;
    event(w, 'defeat', t.x, t.y, p.id);
  }
}
export function step(w: World, inputs: Map<string, Input>, dt = DT) {
  if (w.finished) return;
  w.tick++;
  w.time -= dt;
  for (const p of w.players) {
    for (const key of [
      'cooldown',
      'dodge',
      'invulnerable',
      'stun',
      'ability',
      'interactCooldown',
    ] as const)
      p[key] = Math.max(0, p[key] - dt);
    p.stamina = Math.min(100, p.stamina + dt * (p.block ? 2 : 17));
    if (p.hp <= 0) {
      if (w.mode === 'squad' || (isBoss(w) && p.team === 0 && w.phase !== 'challenge')) {
        p.respawn -= dt;
        if (p.respawn <= 0) {
          p.hp = 100;
          p.x = p.team ? 990 : 210;
          p.y = 360;
          p.invulnerable = 2;
        }
      }
      continue;
    }
    const i =
      w.mode === 'campaign'
        ? (inputs.get(p.id) ?? (p.bot ? botInput(p, w) : undefined))
        : p.bot
          ? botInput(p, w)
          : inputs.get(p.id);
    if (i) {
      move(p, i, dt, w.geometry);
      p.seq = i.seq;
      if (i.ability && p.ability <= 0 && p.stamina >= 30) {
        p.stamina -= 30;
        p.ability = 8;
        if (p.role === 'guardian') {
          p.invulnerable = 1;
          for (const q of w.players.filter(
            (q) => q.hp > 0 && q.team === p.team && Math.hypot(q.x - p.x, q.y - p.y) < 160,
          ))
            q.hp = Math.min(q.maxHp ?? 100, q.hp + 12);
        } else if (p.role === 'rider') {
          p.invulnerable = 0.5;
          p.vx = Math.cos(p.aim) * 700;
          p.vy = Math.sin(p.aim) * 700;
        } else p.cooldown = 0;
        event(w, 'ability', p.x, p.y, p.id);
      }
      if (i.attack && p.cooldown <= 0 && p.stamina >= 12) {
        p.stamina -= 12;
        p.cooldown = 0.62;
        p.attack = 0.34;
        p.attackId++;
        p.hits = [];
        event(w, p.mount || p.role === 'archer' ? 'throw' : 'swing', p.x, p.y, p.id);
        if ((p.mount || p.role === 'archer') && w.mode !== 'duel' && w.mode !== 'tutorial')
          w.projectiles.push({
            id: w.tick * 100 + w.players.indexOf(p),
            owner: p.id,
            kind: p.mount ? 'spear' : p.kind === 'caster' ? 'magic' : 'arrow',
            team: p.team,
            x: p.x,
            y: p.y,
            vx: Math.cos(p.aim) * (620 + (p.mount?.speed ?? 0) * 0.45),
            vy: Math.sin(p.aim) * (620 + (p.mount?.speed ?? 0) * 0.45),
            life: 1.2,
          });
      }
    }
    if (p.attack > 0) {
      p.attack -= dt;
      if (p.attack < 0.23 && p.attack > 0.09) {
        const ranged =
          (p.mount || p.role === 'archer') && w.mode !== 'duel' && w.mode !== 'tutorial';
        if (!ranged) {
          for (const t of w.players)
            if (
              t.team !== p.team &&
              !p.hits.includes(t.id) &&
              inArc(p, t, p.role === 'spear' ? 140 : 105, p.role === 'spear' ? 0.4 : 1.05)
            ) {
              p.hits.push(t.id);
              damage(w, p, t, p.role === 'spear' ? 24 : 18);
            }
        }
        if (
          isBoss(w) &&
          ['guardian', 'challenge', 'eclipse'].includes(w.phase) &&
          p.team === 0 &&
          w.telegraph !== 'shield' &&
          !w.campaign?.shielded &&
          !p.hits.includes('boss') &&
          inArc(p, { x: w.bossX, y: w.bossY }, 150, 1.3) &&
          (w.phase !== 'challenge' || w.challengeOrder[w.challenger] === p.id)
        ) {
          p.hits.push('boss');
          const amount = w.telegraph === 'vulnerable' ? 32 : 18;
          w.bossHp = Math.max(0, w.bossHp - amount);
          p.contribution += amount;
          p.damage += amount;
          w.champion = p.id;
          event(w, 'hit', w.bossX, w.bossY, p.id, amount);
        }
      }
    }
  }
  for (let a = 0; a < w.players.length; a++)
    for (let b = a + 1; b < w.players.length; b++) {
      const p = w.players[a],
        q = w.players[b];
      if (p.hp <= 0 || q.hp <= 0) continue;
      const dx = q.x - p.x,
        dy = q.y - p.y,
        d = Math.hypot(dx, dy);
      const pr = p.mount ? 26 : 20,
        qr = q.mount ? 26 : 20;
      if (d < pr + qr && d > 0.01) {
        const push = (pr + qr - d) / 2;
        if (!wall(p.x - (dx / d) * push, p.y - (dy / d) * push, pr, w.geometry)) {
          p.x -= (dx / d) * push;
          p.y -= (dy / d) * push;
        }
        if (!wall(q.x + (dx / d) * push, q.y + (dy / d) * push, qr, w.geometry)) {
          q.x += (dx / d) * push;
          q.y += (dy / d) * push;
        }
      }
    }
  for (const a of w.projectiles) {
    if (a.kind === 'spear' && w.wind) {
      a.vx += w.wind.x * dt;
      a.vy += w.wind.y * dt;
    }
    const nx = a.x + a.vx * dt,
      ny = a.y + a.vy * dt;
    for (const t of w.players)
      if (t.team !== a.team && t.hp > 0 && segmentHit(a.x, a.y, nx, ny, t.x, t.y, 22)) {
        const owner = w.players.find((p) => p.id === a.owner);
        if (owner) damage(w, owner, t, a.kind === 'spear' ? 24 : 16);
        else if (a.owner === 'boss') bossHit(w, t, w.demo ? 8 : 16);
        a.life = 0;
        break;
      }
    if (
      a.team === 0 &&
      isBoss(w) &&
      ['guardian', 'challenge', 'eclipse'].includes(w.phase) &&
      w.telegraph !== 'shield' &&
      !w.campaign?.shielded &&
      a.life > 0 &&
      segmentHit(a.x, a.y, nx, ny, w.bossX, w.bossY, 50) &&
      (w.phase !== 'challenge' || w.challengeOrder[w.challenger] === a.owner)
    ) {
      const p = w.players.find((p) => p.id === a.owner);
      if (p) {
        const amount = w.telegraph === 'vulnerable' ? 28 : 16;
        w.bossHp = Math.max(0, w.bossHp - amount);
        p.damage += amount;
        p.contribution += amount;
        w.champion = p.id;
        event(w, 'hit', w.bossX, w.bossY, p.id, amount);
      }
      a.life = 0;
    }
    if (wall(nx, ny, 3, w.geometry)) a.life = 0;
    a.x = nx;
    a.y = ny;
    a.life -= dt;
  }
  w.projectiles = w.projectiles.filter((a) => a.life > 0);
  if (w.mode === 'tutorial') {
    const p = w.players[0],
      i = p && inputs.get(p.id);
    if (p && w.phase === 'movement' && Math.hypot(p.x - 230, p.y - 350) > 100) w.phase = 'attack';
    if (p && w.phase === 'attack' && p.damage >= 36) w.phase = 'defend';
    if (i && w.phase === 'defend' && i.block) w.phase = 'dodge';
    if (p && w.phase === 'dodge' && p.dodge > 0.8) {
      w.finished = true;
      w.winner = 0;
    }
  }
  if (w.mode === 'duel' && w.players.length >= 2) {
    const dead = w.players.find((p) => p.hp <= 0);
    if (dead) {
      w.finished = true;
      w.winner = 1 - dead.team;
    } else if (w.time <= 0) {
      w.finished = true;
      w.winner = [...w.players].sort(
        (a, b) => b.hp - a.hp || b.damage - a.damage || a.id.localeCompare(b.id),
      )[0].team;
    }
  }
  if (w.mode === 'squad') {
    for (const z of w.zones) {
      const teams = [0, 1].map(
        (t) =>
          w.players.filter(
            (p) => p.team === t && p.hp > 0 && Math.hypot(p.x - z.x, p.y - z.y) < 100,
          ).length,
      );
      if (teams[0] > 0 && teams[1] === 0) z.progress = Math.max(-3, z.progress - dt);
      if (teams[1] > 0 && teams[0] === 0) z.progress = Math.min(3, z.progress + dt);
      if (z.progress <= -3) z.owner = 0;
      if (z.progress >= 3) z.owner = 1;
      if (z.owner >= 0) w.scores[z.owner] += dt * 2;
    }
    if (w.time <= 0 || Math.max(...w.scores) >= 300) {
      w.finished = true;
      w.winner = w.scores[0] >= w.scores[1] ? 0 : 1;
    }
  }
  if (isBoss(w)) quest(w, inputs, dt);
}
export function isBoss(w: World) {
  return w.mode === 'quest' || !!w.campaign?.boss;
}
function startBoss(w: World, phase: string, hp: number) {
  w.phase = phase;
  w.bossHp = hp;
  w.bossMax = hp;
  w.bossTimer = 0;
  w.bossX = 900;
  w.bossY = 380;
  w.telegraph = '';
  if (phase === 'challenge')
    w.challengeOrder = [...w.players]
      .filter((p) => p.team === 0)
      .sort(
        (a, b) => b.contribution - a.contribution || w.players.indexOf(a) - w.players.indexOf(b),
      )
      .map((p) => p.id);
  for (const p of w.players.filter((p) => p.team === 0)) {
    p.hp = 100;
    p.respawn = 0;
  }
}
function quest(w: World, inputs: Map<string, Input>, dt: number) {
  for (const p of w.players.filter((p) => !p.bot && p.hp > 0)) {
    if (!inputs.get(p.id)?.interact) {
      p.lastPillar = -1;
      continue;
    }
    if (w.phase === 'artifacts')
      artifacts.forEach((a, n) => {
        if (!w.artifacts[n] && Math.hypot(a.x - p.x, a.y - p.y) < 85) {
          w.artifacts[n] = true;
          p.contribution += 25;
          event(w, 'artifact', a.x, a.y, p.id);
        }
      });
    if (w.phase === 'puzzle') {
      const nearest = pillars
        .map((a, n) => ({ a, n, d: Math.hypot(a.x - p.x, a.y - p.y) }))
        .sort((a, b) => a.d - b.d)[0];
      const { a, n } = nearest;
      if (nearest.d < 75 && p.lastPillar !== n && p.interactCooldown <= 0) {
        p.lastPillar = n;
        p.interactCooldown = 0.65;
        if (n === PUZZLE[w.puzzle.length]) {
          w.puzzle.push(n);
          if (!(p.puzzleCredits & (1 << n))) {
            p.contribution += 15;
            p.puzzleCredits |= 1 << n;
          }
        } else w.puzzle = [];
        event(
          w,
          'pillar',
          a.x,
          a.y,
          p.id,
          undefined,
          n === PUZZLE[w.puzzle.length - 1] ? 'Correct' : 'Sequence reset',
        );
      }
    }
  }
  if (w.phase === 'artifacts' && w.artifacts.every(Boolean)) w.phase = 'puzzle';
  if (w.phase === 'puzzle' && w.puzzle.length === 4) startBoss(w, 'guardian', w.demo ? 240 : 700);
  if (['guardian', 'challenge', 'eclipse'].includes(w.phase)) {
    w.bossTimer += dt;
    const period = 4,
      cycle = w.bossTimer % period;
    w.telegraph = cycle > 2.5 && cycle < 3.4 ? 'shockwave' : cycle >= 3.4 ? 'vulnerable' : '';
    const alive = w.players
      .filter(
        (p) =>
          p.hp > 0 &&
          p.team === 0 &&
          (w.phase !== 'challenge' || p.id === w.challengeOrder[w.challenger]),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - w.bossX, a.y - w.bossY) - Math.hypot(b.x - w.bossX, b.y - w.bossY),
      );
    const t = alive[0];
    if (t && cycle < 2.5) {
      const a = Math.atan2(t.y - w.bossY, t.x - w.bossX);
      w.bossX += Math.cos(a) * dt * 55;
      w.bossY += Math.sin(a) * dt * 55;
    }
    if (
      w.tick % 45 === 0 &&
      t &&
      Math.hypot(t.x - w.bossX, t.y - w.bossY) < 90 &&
      t.invulnerable <= 0
    ) {
      t.hp = Math.max(0, t.hp - (w.demo ? 10 : 20));
      t.respawn = 4;
      event(w, 'hit', t.x, t.y, 'boss', 20);
    }
    if (cycle >= 3.35 && cycle < 3.35 + dt) {
      for (const p of alive)
        if (Math.hypot(p.x - w.bossX, p.y - w.bossY) < 190 && p.invulnerable <= 0) {
          p.hp = Math.max(0, p.hp - (w.demo ? 12 : 30));
          p.respawn = 4;
          event(w, 'hit', p.x, p.y, 'boss', 30);
        }
    }

    if (w.phase === 'guardian' && cycle > 1.3 && cycle < 1.8 && t) {
      w.telegraph = 'charge';
      const a = Math.atan2(t.y - w.bossY, t.x - w.bossX);
      const nx = w.bossX + Math.cos(a) * dt * 240,
        ny = w.bossY + Math.sin(a) * dt * 240;
      if (!wall(nx, ny, 45)) {
        w.bossX = nx;
        w.bossY = ny;
      }
    }
    if (w.phase === 'eclipse') {
      if (cycle > 0.7 && cycle < 1.4) w.telegraph = 'shield';
      if (w.tick % 120 === 0) {
        for (let n = 0; n < 8; n++) {
          const a = (n * Math.PI) / 4;
          w.projectiles.push({
            id: w.tick * 100 + n,
            owner: 'boss',
            team: 1,
            x: w.bossX,
            y: w.bossY,
            vx: Math.cos(a) * 240,
            vy: Math.sin(a) * 240,
            life: 2.4,
          });
        }
        event(w, 'spell', w.bossX, w.bossY, 'boss');
      }
      if (w.tick % 240 === 0 && w.players.filter((p) => p.team === 1).length < 2) {
        const shadow = fighter('shadow' + w.tick, 'Eclipse Shadow', 1, true, 0, 'guardian');
        shadow.x = w.bossX - 130;
        shadow.y = w.bossY + 70;
        shadow.hp = 35;
        w.players.push(shadow);
        event(w, 'summon', shadow.x, shadow.y, 'boss');
      }
    }
    if (w.phase === 'challenge') {
      const order = w.challengeOrder.map((id) => w.players.find((p) => p.id === id));
      if (!order[w.challenger] || order[w.challenger]!.hp <= 0) w.challenger++;
      if (w.challenger >= order.length || w.bossTimer > 40)
        startBoss(w, 'eclipse', w.demo ? 430 : 1200);
    }
    if (w.bossHp <= 0) {
      if (w.phase === 'guardian') startBoss(w, 'challenge', w.demo ? 130 : 500);
      else if (w.phase === 'challenge') startBoss(w, 'eclipse', w.demo ? 430 : 1200);
      else {
        w.finished = true;
        w.winner = 0;
        w.phase = 'victory';
      }
    }
  }
}
export interface Progress {
  wins: number;
  losses: number;
  qualifying: number;
  remainder: number;
  stage: number;
  xp: number;
  points: number;
  rating: number;
  squadRating: number;
  squadWins: number;
  tutorial: boolean;
}
export const freshProgress = (): Progress => ({
  wins: 0,
  losses: 0,
  qualifying: 0,
  remainder: 0,
  stage: 1,
  xp: 0,
  points: 0,
  rating: 1000,
  squadRating: 1000,
  squadWins: 0,
  tutorial: false,
});
export function progressResult(
  old: Progress,
  win: boolean,
  mode: Mode,
  demo: boolean,
  contribution = 0,
): Progress {
  const p = { ...old };
  if (mode === 'tutorial') {
    p.tutorial = true;
    return p;
  }
  p.xp += win ? 100 : 20;
  p.points += win ? 100 + Math.min(50, Math.floor(contribution / 20)) : 0;
  if (mode === 'duel') {
    if (win) {
      p.wins++;
      p.qualifying++;
    } else {
      p.losses++;
      p.remainder++;
      if (p.remainder === 3) {
        p.qualifying = Math.max(0, p.qualifying - 1);
        p.remainder = 0;
      }
    }
    p.rating = Math.max(0, p.rating + (win ? 25 : -20));
    if (p.qualifying >= (demo ? 1 : 10)) p.stage = Math.max(p.stage, 2);
  }
  if (mode === 'squad') {
    p.squadRating = Math.max(0, p.squadRating + (win ? 50 : -25));
    if (win) p.squadWins++;
  }
  return p;
}

function bossHit(w: World, p: Fighter, amount: number) {
  if (p.invulnerable > 0 || p.hp <= 0) return;
  if (p.block) {
    p.stamina = Math.max(0, p.stamina - 10);
    amount = Math.ceil(amount / 3);
  }
  p.hp = Math.max(0, p.hp - amount);
  if (p.hp <= 0) {
    p.deaths++;
    p.respawn = 4;
  }
  event(w, 'hit', p.x, p.y, 'boss', amount);
}
