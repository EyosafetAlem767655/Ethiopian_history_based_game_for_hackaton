import {
  obstacles,
  artifacts,
  pillars,
  PUZZLE,
  type Input,
  type World,
  type Fighter,
} from '../packages/shared/src/game';
import type { Geometry } from '../packages/shared/src/presentation';
function blocked(x: number, y: number, geometry?: Geometry) {
  return (
    x < 90 ||
    x > (geometry?.width ?? 1200) - 90 ||
    y < 110 ||
    y > (geometry?.height ?? 760) - 100 ||
    (geometry?.obstacles ?? obstacles).some(
      (o) => x > o.x - 30 && x < o.x + o.w + 30 && y > o.y - 30 && y < o.y + o.h + 30,
    )
  );
}
export function direction(p: Fighter, tx: number, ty: number, geometry?: Geometry) {
  const size = 40,
    start = [Math.round(p.x / size), Math.round(p.y / size)],
    end = [Math.round(tx / size), Math.round(ty / size)],
    key = (a: number[]) => a.join(',');
  const queue = [start],
    prev = new Map<string, number[] | null>([[key(start), null]]);
  let found: number[] | null = null;
  for (let n = 0; n < queue.length; n++) {
    const a = queue[n];
    if (Math.hypot(a[0] - end[0], a[1] - end[1]) < 1.5) {
      found = a;
      break;
    }
    for (const d of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const b = [a[0] + d[0], a[1] + d[1]];
      if (!prev.has(key(b)) && !blocked(b[0] * size, b[1] * size, geometry)) {
        prev.set(key(b), a);
        queue.push(b);
      }
    }
  }
  if (found) {
    let next = found;
    while (prev.get(key(next)) && key(prev.get(key(next))!) !== key(start))
      next = prev.get(key(next))!;
    if (Math.hypot(tx - p.x, ty - p.y) > 90) {
      tx = next[0] * size;
      ty = next[1] * size;
    }
  }
  const dx = tx - p.x,
    dy = ty - p.y,
    d = Math.hypot(dx, dy);
  return { x: d > 9 ? dx / d : 0, y: d > 9 ? dy / d : 0 };
}
export function control(w: World, id: string, seq: number): Input {
  const p = w.players.find((p) => p.id === id)!;
  let tx = 700,
    ty = 350,
    attack = false,
    block = false,
    dodge = false,
    interact = false;
  if (w.mode === 'tutorial') {
    if (w.phase === 'movement') {
      tx = 570;
      ty = 350;
    } else if (w.phase === 'attack') {
      const dummy = w.players.find((q) => q.id !== id)!;
      tx = dummy.x - 65;
      ty = dummy.y;
      attack = Math.hypot(dummy.x - p.x, dummy.y - p.y) < 100;
    } else if (w.phase === 'defend') block = true;
    else dodge = true;
  }
  if (w.mode === 'duel') {
    const enemy = w.players.find((q) => q.team !== p.team);
    if (enemy) {
      tx = enemy.x - 65;
      ty = enemy.y;
      attack = true;
    }
  }
  if (w.mode === 'squad') {
    // Exercise capture objectives rather than camp one contested zone and assume
    // an automatic win against randomly assigned bot roles.
    const target =
      [...w.zones]
        .filter((z) => z.owner !== p.team)
        .sort((a, b) => {
          const cost = (z: { x: number; y: number }) =>
            Math.hypot(z.x - p.x, z.y - p.y) +
            300 *
              w.players.filter(
                (q) => q.team !== p.team && q.hp > 0 && Math.hypot(q.x - z.x, q.y - z.y) < 180,
              ).length;
          return cost(a) - cost(b);
        })[0] ?? w.zones[1];
    tx = target.x;
    ty = target.y;
    attack = true;
  }
  if (w.mode === 'quest') {
    if (w.phase === 'artifacts') {
      const a = artifacts[w.artifacts.findIndex((a) => !a)];
      tx = a.x;
      ty = a.y;
      interact = true;
    } else if (w.phase === 'puzzle') {
      const a = pillars[PUZZLE[w.puzzle.length]];
      tx = a.x;
      ty = a.y;
      interact = Math.hypot(p.x - tx, p.y - ty) < 50;
    } else {
      tx = w.bossX - 85;
      ty = w.bossY;
      attack = true;
      dodge = w.telegraph === 'shockwave' && w.bossTimer % 4 > 3;
    }
  }
  const target =
    w.mode === 'quest' && ['guardian', 'challenge', 'eclipse'].includes(w.phase)
      ? { x: w.bossX, y: w.bossY }
      : ([...w.players]
          .filter((q) => q.team !== p.team && q.hp > 0)
          .sort(
            (a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
          )[0] ?? { x: 700, y: 350 });
  return {
    seq,
    ...direction(p, tx, ty, w.geometry),
    aim: Math.atan2(target.y - p.y, target.x - p.x),
    attack,
    block,
    dodge,
    interact,
    ability: attack && w.tick % 90 < 4,
  };
}
