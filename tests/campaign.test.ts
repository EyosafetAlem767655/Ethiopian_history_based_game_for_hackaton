import { expect, it } from 'vitest';
import {
  campaignWorld,
  equipCampaign,
  emptyInput,
  stepCampaign,
  sequenceFor,
  missionTier,
} from '../packages/shared/src/campaign';
import {
  completeMission,
  freshCampaign,
  missionEligibility,
  MISSIONS,
} from '../packages/shared/src/missions';
import { fighter, move, step, wall, damage, DT, type Input } from '../packages/shared/src/game';
import { project, unproject, screenMovement } from '../packages/shared/src/presentation';
const make = (id: number, demo = true) => {
  const w = campaignWorld(id, demo, 71);
  w.players = [equipCampaign(fighter('human', 'Human'), w)];
  return w;
};
it('round trips world projection and camera zoom aiming', () => {
  for (const [x, y] of [
    [0, 0],
    [230, 400],
    [1680, 1080],
    [-80, 333],
  ]) {
    const projected = project(x, y);
    expect(unproject(projected.x, projected.y).x).toBeCloseTo(x);
    expect(unproject(projected.x, projected.y).y).toBeCloseTo(y);
    for (const zoom of [0.8, 1.45, 2.3]) {
      const screen = { x: (projected.x - 150) * zoom + 720, y: (projected.y + 70) * zoom + 400 };
      const aim = unproject((screen.x - 720) / zoom + 150, (screen.y - 400) / zoom - 70);
      expect(aim.x).toBeCloseTo(x);
      expect(aim.y).toBeCloseTo(y);
    }
  }
  const arrow = screenMovement(0, -1);
  expect(project(arrow.x, arrow.y).y).toBeLessThan(0);
  expect(project(arrow.x, arrow.y).x).toBeCloseTo(0);
});
it('mounts accelerate, retain momentum, brake, and turn slower at speed', () => {
  const w = make(2),
    p = w.players[0],
    i = { ...emptyInput(), x: 1 };
  p.x = 400;
  p.y = 400;
  move(p, i, DT, w.geometry);
  expect(p.mount!.speed).toBeGreaterThan(0);
  expect(p.mount!.speed).toBeLessThan(30);
  for (let n = 0; n < 30; n++) move(p, i, DT, w.geometry);
  const speed = p.mount!.speed;
  move(p, emptyInput(), DT, w.geometry);
  expect(p.mount!.speed).toBeGreaterThan(0);
  expect(p.mount!.speed).toBeLessThan(speed);
  const slow = structuredClone(p),
    fast = structuredClone(p);
  slow.mount!.speed = 0;
  fast.mount!.speed = 350;
  slow.mount!.heading = fast.mount!.heading = 0;
  move(slow, { ...i, x: 0, y: 1 }, DT, w.geometry);
  move(fast, { ...i, x: 0, y: 1 }, DT, w.geometry);
  expect(slow.mount!.heading).toBeGreaterThan(fast.mount!.heading);
});
it('wind changes a thrown spear without changing arrow trajectories', () => {
  const w = make(4),
    p = w.players[0];
  p.x = 300;
  p.y = 300;
  stepCampaign(w, new Map([[p.id, { ...emptyInput(), attack: true, aim: 0 }]]));
  const spear = w.projectiles.find((q) => q.owner === p.id)!;
  expect(spear.kind).toBe('spear');
  expect(spear.vy).toBeGreaterThan(0);
});
it('lets mounts ride inward after crowd separation at the arena wall', () => {
  const w = make(2),
    p = w.players[0];
  p.x = 1119;
  p.y = 400;
  p.mount!.heading = Math.PI;
  const q = equipCampaign(fighter('friend', 'Friend'), w);
  q.x = 1100;
  q.y = 390;
  w.players.push(q);
  for (let n = 0; n < 90; n++) stepCampaign(w, new Map([[p.id, { ...emptyInput(n), x: -1 }]]));
  expect(p.x).toBeLessThan(900);
  expect(p.x).toBeGreaterThanOrEqual(86);
});
it('keeps new mission progress separate from legacy stages and gates the gathering', () => {
  let p = freshCampaign();
  expect(p.completed).toEqual([]);
  expect(missionEligibility(p, 2, false)).toContain('preceding');
  for (let id = 1; id <= 10; id++) p = completeMission(p, id, 20);
  expect(missionEligibility(p, 11, false)).toContain('Gathering');
  p.fellowship = true;
  expect(missionEligibility(p, 11, false)).toBeNull();
  const once = completeMission(p, 11, 20, 40);
  expect(completeMission(once, 11, 100, 1000)).toEqual(once);
  expect(once.honor).toBe(220);
  expect(new Set(MISSIONS.map((m) => m.kind)).size).toBe(15);
});
it('uses seeded server puzzle validation and rejects incorrect order', () => {
  const w = make(12),
    p = w.players[0],
    c = w.campaign!;
  expect(sequenceFor(71)).toEqual(sequenceFor(71));
  expect(sequenceFor(72)).not.toEqual(sequenceFor(71));
  const select = (index: number) => {
    const a = c.markers[index];
    p.x = a.x;
    p.y = a.y;
    p.interactCooldown = 0;
    p.lastPillar = -1;
    stepCampaign(w, new Map([[p.id, { ...emptyInput(), interact: true }]]));
  };
  select((c.sequence[0] + 1) % 4);
  expect(c.entered).toEqual([]);
  for (let round = 0; round < 3; round++) for (const index of [...c.sequence]) select(index);
  expect(w.finished).toBe(true);
  expect(w.winner).toBe(0);
});
it('requires a moving horse to clear rings and actual interaction for rescue', () => {
  const riding = make(2),
    p = riding.players[0],
    ring = riding.campaign!.markers[0];
  p.x = ring.x;
  p.y = ring.y;
  stepCampaign(riding, new Map());
  expect(ring.done).toBe(false);
  p.mount!.speed = 80;
  stepCampaign(riding, new Map());
  expect(ring.done).toBe(true);
  const w = make(8),
    q = w.players[0],
    captive = w.campaign!.markers[0];
  q.x = captive.x;
  q.y = captive.y;
  stepCampaign(w, new Map());
  expect(captive.done).toBe(false);
  for (let n = 0; n < 32; n++)
    stepCampaign(w, new Map([[q.id, { ...emptyInput(), interact: true }]]));
  expect(captive.done).toBe(true);
  const honor = q.honor;
  for (let n = 0; n < 40; n++)
    stepCampaign(w, new Map([[q.id, { ...emptyInput(), interact: true }]]));
  expect(q.honor).toBe(honor);
});
it('revives through sustained interaction and credits honor only once', () => {
  const w = make(8),
    p = w.players[0],
    down = fighter('down', 'Companion');
  down.hp = 0;
  down.x = p.x + 40;
  down.y = p.y;
  w.players.push(down);
  for (let n = 0; n < 32; n++)
    stepCampaign(w, new Map([[p.id, { ...emptyInput(), interact: true }]]));
  expect(down.hp).toBeGreaterThan(0);
  expect(p.honor).toBe(20);
  down.hp = 0;
  for (let n = 0; n < 32; n++)
    stepCampaign(w, new Map([[p.id, { ...emptyInput(), interact: true }]]));
  expect(p.honor).toBe(20);
});
it('awards protection honor once to an active defender after the oath is secured', () => {
  const w = make(1),
    p = w.players[0],
    npc = fighter('trainee', 'Trainee');
  npc.kind = 'civilian';
  npc.hp = 220;
  w.players.push(npc);
  w.campaign!.wave = 5;
  w.tick = 1800;
  p.damage = 18;
  stepCampaign(w, new Map());
  expect(w.finished).toBe(true);
  expect(w.winner).toBe(0);
  expect(p.honor).toBe(40);
  stepCampaign(w, new Map());
  expect(p.honor).toBe(40);
});
it('places checkpoint ambushes outside terrain obstacles and river water', () => {
  for (const id of [7]) {
    const w = make(id, false),
      p = w.players[0],
      bearer = fighter('bearer', 'Bearer');
    w.campaign!.wave = 1;
    w.campaign!.escort = 1;
    w.campaign!.markers.filter((a) => a.kind === 'captive').forEach((a) => (a.done = true));
    bearer.kind = 'civilian';
    bearer.x = 1000;
    bearer.y = 450;
    p.x = 1000;
    p.y = 490;
    w.players.push(bearer);
    stepCampaign(w, new Map());
    const enemies = w.players.filter((q) => q.team === 1);
    expect(enemies).toHaveLength(3);
    for (const enemy of enemies) expect(wall(enemy.x, enemy.y, 20, w.geometry)).toBe(false);
  }
});
it('solves three distinct receiver alignments in the normal observatory', () => {
  const w = make(13, false),
    p = w.players[0],
    c = w.campaign!;
  for (let round = 0; round < 3; round++) {
    for (let j = 0; j < 3; j++) {
      while (c.markers[j].value !== c.mirrorTargets[j]) {
        p.x = c.markers[j].x;
        p.y = c.markers[j].y;
        p.lastPillar = -1;
        p.interactCooldown = 0;
        stepCampaign(w, new Map([[p.id, { ...emptyInput(), interact: true }]]));
      }
    }
  }
  expect(w.finished).toBe(true);
  expect(c.mirrorRound).toBe(3);
});

it('ramps difficulty: the oath unleashes one monster at a time and the bearer fights back', () => {
  const w = make(1, false),
    enemies = () => w.players.filter((q) => q.team === 1 && q.hp > 0);
  stepCampaign(w, new Map());
  expect(enemies()).toHaveLength(1);
  const bearer = w.players.find((q) => q.id === 'trainee')!;
  expect(bearer.maxHp).toBe(300);
  let most = 0;
  // Keep the human out of the fight for 90 seconds of simulated time.
  for (let n = 0; n < 30 * 90 && !w.finished; n++) {
    w.players[0].hp = 100;
    stepCampaign(w, new Map());
    most = Math.max(most, enemies().length);
  }
  expect(most).toBeLessThanOrEqual(2);
  expect(bearer.attackId).toBeGreaterThan(0);
  // Early monsters are weaker than the final mission's.
  const early = make(1, false),
    late = make(15, false);
  expect(missionTier(1)).toBe(0);
  expect(missionTier(15)).toBe(1);
  stepCampaign(early, new Map());
  const first = early.players.find((q) => q.team === 1)!;
  expect(first.maxHp).toBeLessThan(85);
  expect(late.campaign!.missionId).toBe(15);
});
it('holds the ford: raiders drain it, clearing every wave wins', () => {
  const lost = make(5, false),
    enemies = (w: typeof lost) => w.players.filter((q) => q.team === 1 && q.hp > 0);
  stepCampaign(lost, new Map());
  const ford = lost.campaign!.markers[0];
  expect(ford.value).toBe(100);
  expect(enemies(lost)).toHaveLength(1);
  // A monster parked on the ford drains it until the ford falls.
  enemies(lost)[0].x = ford.x;
  enemies(lost)[0].y = ford.y;
  lost.players[0].x = 100;
  for (let n = 0; n < 30 * 40 && !lost.finished; n++) {
    enemies(lost)[0].x = ford.x;
    enemies(lost)[0].y = ford.y;
    lost.players[0].hp = 100;
    stepCampaign(lost, new Map());
  }
  expect(lost.finished).toBe(true);
  expect(lost.winner).toBe(1);
  const won = make(5, false);
  for (let n = 0; n < 30 * 60 && !won.finished; n++) {
    for (const e of enemies(won)) e.hp = 0;
    stepCampaign(won, new Map());
  }
  expect(won.finished).toBe(true);
  expect(won.winner).toBe(0);
  expect(won.campaign!.wave).toBe(3);
});
it('gives ford defenders damage resistance and one second wind per wave', () => {
  const w = make(5, false),
    p = w.players[0];
  stepCampaign(w, new Map());
  const monster = w.players.find((q) => q.team === 1)!;
  // A heavy blow is reduced by 40% (after the early-mission monster scaling).
  p.hp = 100;
  damage(w, monster, p, 50);
  expect(100 - p.hp).toBeLessThan(25);
  // The first killing blow this wave leaves the defender standing and briefly invulnerable.
  p.hp = 5;
  p.invulnerable = 0;
  damage(w, monster, p, 80);
  expect(p.hp).toBeGreaterThan(0);
  expect(p.invulnerable).toBeGreaterThan(0);
  // A second killing blow in the same wave is not saved.
  p.hp = 5;
  p.invulnerable = 0;
  damage(w, monster, p, 80);
  expect(p.hp).toBe(0);
  // The next wave restores it.
  p.hp = 5;
  w.defenderGuard!.wave++;
  damage(w, monster, p, 80);
  expect(p.hp).toBeGreaterThan(0);
});

it('lets Chapter 2 heroes throw an aimed spear on foot', () => {
  const w = make(6, false),
    p = w.players[0];
  expect(p.mount).toBeFalsy();
  p.cooldown = 0;
  p.stamina = 100;
  stepCampaign(w, new Map([[p.id, { ...emptyInput(w.tick + 1), attack: true, aim: Math.PI / 2 }]]));
  const spear = w.projectiles.find((a) => a.owner === p.id);
  expect(spear?.kind).toBe('spear');
  expect(spear!.vy).toBeGreaterThan(500);
  // Chapter 1 on foot still swings in melee.
  const ford = make(5, false),
    q = ford.players[0];
  q.cooldown = 0;
  q.stamina = 100;
  stepCampaign(ford, new Map([[q.id, { ...emptyInput(ford.tick + 1), attack: true }]]));
  expect(ford.projectiles.some((a) => a.owner === q.id)).toBe(false);
});
