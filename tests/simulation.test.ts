import { describe, it, expect } from 'vitest';
import {
  fighter,
  world,
  step,
  move,
  inArc,
  segmentHit,
  inputSchema,
  freshProgress,
  progressResult,
  DT,
  PUZZLE,
  pillars,
  shuffledRoles,
  type Input,
} from '../packages/shared/src/game';
const input = (v: Partial<Input> = {}): Input => ({
  seq: 1,
  x: 0,
  y: 0,
  aim: 0,
  attack: false,
  block: false,
  dodge: false,
  ability: false,
  interact: false,
  ...v,
});
describe('authoritative simulation', () => {
  it('normalizes diagonal input and respects arena walls', () => {
    const p = fighter('a', 'A');
    p.x = 600;
    p.y = 380;
    for (let n = 0; n < 300; n++) move(p, input({ x: 1, y: 1 }), DT);
    expect(p.x).toBeLessThanOrEqual(1120);
    expect(p.y).toBeLessThanOrEqual(680);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(206);
  });
  it('rejects arbitrary coordinates, health, stale-shaped input and infinite aim', () => {
    expect(inputSchema.safeParse({ ...input(), hp: 999 }).success).toBe(false);
    expect(inputSchema.safeParse(input({ aim: Infinity })).success).toBe(false);
    expect(inputSchema.safeParse(input({ x: 4 })).success).toBe(false);
  });
  it('checks directional arcs and minimum distance', () => {
    const p = { x: 0, y: 0, aim: 0 };
    expect(inArc(p, { x: 60, y: 0 })).toBe(true);
    expect(inArc(p, { x: -60, y: 0 })).toBe(false);
    expect(inArc(p, { x: 0, y: 0 })).toBe(false);
  });
  it('sweeps projectiles across a target', () => {
    expect(segmentHit(0, 0, 1000, 0, 450, 10, 22)).toBe(true);
    expect(segmentHit(0, 0, 1000, 0, 450, 50, 22)).toBe(false);
  });
  it('damages once per swing and enforces cooldown and stamina', () => {
    const w = world('duel', false),
      a = fighter('a', 'A'),
      b = fighter('b', 'B', 1);
    a.x = 500;
    a.y = 380;
    b.x = 570;
    b.y = 380;
    w.players = [a, b];
    const inputs = new Map([['a', input({ attack: true })]]);
    for (let n = 0; n < 15; n++) step(w, inputs);
    expect(b.hp).toBe(82);
    expect(a.stamina).toBeLessThan(100);
    expect(a.cooldown).toBeGreaterThan(0);
  });
  it('blocks only attacks in front', () => {
    const w = world('duel', false),
      a = fighter('a', 'A'),
      b = fighter('b', 'B', 1);
    a.x = 500;
    a.y = 380;
    b.x = 570;
    b.y = 380;
    w.players = [a, b];
    for (let n = 0; n < 15; n++)
      step(
        w,
        new Map([
          ['a', input({ attack: true })],
          ['b', input({ block: true, aim: Math.PI })],
        ]),
      );
    expect(b.hp).toBe(97);
  });
  it('dodge costs stamina and cannot repeat during cooldown', () => {
    const p = fighter('a', 'A');
    move(p, input({ dodge: true, x: 1 }), DT);
    expect(p.stamina).toBe(75);
    move(p, input({ dodge: true, x: 1 }), DT);
    expect(p.stamina).toBe(75);
    expect(p.invulnerable).toBeGreaterThan(0);
  });
  it('ends a timeout consistently and never changes an ended match', () => {
    const w = world('duel', false);
    w.players = [fighter('a', 'A'), fighter('b', 'B', 1)];
    w.players[0].hp = 90;
    w.time = 0.01;
    step(w, new Map());
    expect(w.finished).toBe(true);
    expect(w.winner).toBe(1);
    const tick = w.tick;
    step(w, new Map());
    expect(w.tick).toBe(tick);
  });
  it('requires the real puzzle sequence near each pillar', () => {
    const w = world('quest', true),
      p = fighter('a', 'A');
    w.players = [p];
    w.phase = 'puzzle';
    for (const n of PUZZLE) {
      p.x = pillars[n].x;
      p.y = pillars[n].y;
      w.tick = Math.ceil((w.tick + 30) / 10) * 10 - 1;
      step(w, new Map([['a', input({ interact: true })]]));
      for (let tick = 0; tick < 25; tick++) step(w, new Map([['a', input()]]));
    }
    expect(w.phase).toBe('guardian');
    expect(w.bossHp).toBeGreaterThan(0);
  });
  it('assigns one of every role without duplication', () => {
    const roles = shuffledRoles(() => 0.25);
    expect(new Set(roles).size).toBe(4);
    expect(roles).toContain('guardian');
    expect(roles).toContain('spear');
    expect(roles).toContain('archer');
    expect(roles).toContain('rider');
  });
  it('selects the nearest overlapping pillar and never repeats a held interaction', () => {
    const w = world('quest', true),
      p = fighter('a', 'A');
    w.players = [p];
    w.phase = 'puzzle';
    w.puzzle = [2, 0];
    p.x = 731;
    p.y = 170;
    for (let n = 0; n < 45; n++) {
      w.events.push({ tick: w.tick, kind: 'swing', x: 600, y: 200, actor: 'unrelated' });
      step(w, new Map([['a', input({ interact: true })]]));
    }
    expect(w.puzzle).toEqual([2, 0, 3]);
    expect(p.contribution).toBe(15);
    step(w, new Map([['a', input()]]));
    p.x = 540;
    p.y = 170;
    step(w, new Map([['a', input({ interact: true })]]));
    expect(w.phase).toBe('guardian');
  });
});
describe('progression', () => {
  it('deducts exactly one qualifying victory every third loss', () => {
    let p = { ...freshProgress(), qualifying: 8, remainder: 2, losses: 2 };
    p = progressResult(p, false, 'duel', false);
    expect(p.qualifying).toBe(7);
    expect(p.remainder).toBe(0);
    expect(p.losses).toBe(3);
    p = progressResult(p, false, 'duel', false);
    expect(p.qualifying).toBe(7);
  });
  it('never goes below zero or relocks Stage 2', () => {
    let p = { ...freshProgress(), stage: 2, remainder: 2 };
    p = progressResult(p, false, 'duel', false);
    expect(p.stage).toBe(2);
    expect(p.qualifying).toBe(0);
  });
  it('isolates fast-track rules to demo', () => {
    expect(progressResult(freshProgress(), true, 'duel', true).stage).toBe(2);
    expect(progressResult(freshProgress(), true, 'duel', false).stage).toBe(1);
  });
  it('caps performance rewards and keeps lifetime xp monotonic', () => {
    const p = progressResult(freshProgress(), true, 'duel', false, 999999);
    expect(p.points).toBe(150);
    expect(progressResult(p, false, 'duel', false).xp).toBe(120);
  });
});
