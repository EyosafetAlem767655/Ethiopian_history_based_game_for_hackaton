import { direction } from './controller';
import { MISSIONS } from '../packages/shared/src/missions';
import { leadAim } from '../packages/shared/src/campaign';
import { angleDiff, type World, type Input } from '../packages/shared/src/game';
export function campaignControl(w: World, id: string, seq: number): Input {
  const p = w.players.find((p) => p.id === id)!,
    c = w.campaign!,
    m = MISSIONS[c.missionId - 1],
    dist = (q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y);
  const enemy = w.players
    .filter((q) => q.team !== p.team && q.hp > 0)
    .sort((a, b) => dist(a) - dist(b))[0];
  let target = { x: p.x, y: p.y },
    attack = false,
    interact = false,
    block = false;
  const combat = (q: { x: number; y: number }) => {
    const d = dist(q),
      ranged = p.role === 'archer' || !!p.mount;
    target = { x: q.x - (ranged ? 230 : 65), y: q.y };
    attack = d < (ranged ? 560 : 150);
  };
  if (m.kind === 'ride') target = c.markers.find((a) => !a.done) ?? target;
  else if (m.kind === 'joust') {
    target = { x: p.x < 1000 ? 1030 : 170, y: 300 };
    if (enemy) {
      attack = dist(enemy) < 350;
    }
  } else if (c.boss) {
    if (m.kind === 'throne' && w.phase === 'eclipse' && c.shielded) {
      target = c.markers.find((a) => !a.done) ?? target;
      interact = dist(target) < 78;
    } else combat({ x: w.bossX, y: w.bossY });
  } else if (m.kind === 'conquest') {
    // Capture the safest unowned objective instead of chasing a rival away from all zones.
    const candidates = w.zones.filter((z) => z.owner !== p.team);
    target = [...(candidates.length ? candidates : w.zones)].sort((a, b) => {
      const cost = (z: typeof a) =>
        dist(z) +
        w.players.filter(
          (q) => q.team !== p.team && q.hp > 0 && Math.hypot(q.x - z.x, q.y - z.y) < 130,
        ).length *
          120;
      return cost(a) - cost(b);
    })[0];
    if (dist(target) < 35) target = { x: p.x, y: p.y };
    attack = !!enemy && dist(enemy) < (p.role === 'archer' || p.mount ? 540 : 145);
    block = !!enemy && enemy.attack > 0 && dist(enemy) < 130;
  } else if (m.kind === 'oath') {
    target = w.players.find((q) => q.id === 'trainee') ?? { x: 600, y: 380 };
    if (enemy) combat(enemy);
  } else if (m.kind === 'escort' || m.kind === 'courier') {
    const captive = c.markers.find((a) => a.kind === 'captive' && !a.done),
      bearer = w.players.find((q) => q.id === 'bearer');
    target = captive ?? bearer ?? target;
    interact = !!captive && dist(captive) < 78;
    if (enemy && dist(enemy) < 400 && !captive) combat(enemy);
  } else if (m.kind === 'capture') {
    target = c.markers[c.carrier ? 0 : 1];
    interact = !c.carrier && dist(target) < 70;
    if (enemy && dist(enemy) < 140) combat(enemy);
  } else if (m.kind === 'mirrors') {
    target = c.markers.find((a, n) => a.value !== c.mirrorTargets[n]) ?? target;
    interact = dist(target) < 65 && p.interactCooldown <= 0;
  } else {
    const puzzle = m.kind === 'symbols' || c.clues === 5;
    target = puzzle
      ? (c.markers[c.sequence[c.entered.length]] ?? target)
      : (c.markers.find((a) => !a.done) ?? enemy ?? target);
    interact =
      dist(target) < (m.kind === 'symbols' ? 45 : 78) && (!puzzle || p.interactCooldown <= 0);
    if (enemy && dist(enemy) < 300 && !puzzle && !interact) combat(enemy);
    if (c.markers.every((a) => a.done) && enemy && !puzzle) combat(enemy);
  }
  let movement = direction(p, target.x, target.y, w.geometry);
  if (dist(target) < 45) {
    movement = { x: 0, y: 0 };
  }
  if (p.mount) {
    const desired = Math.atan2(movement.y, movement.x);
    block = Math.abs(angleDiff(desired, p.mount.heading)) > 0.45;
  }
  const aimTarget = c.boss ? { x: w.bossX, y: w.bossY } : (enemy ?? target);
  const flight = dist(aimTarget) / (620 + (p.mount?.speed ?? 0) * 0.45);
  const aim = Math.atan2(
    aimTarget.y - p.y - (w.wind?.y ?? 0) * flight * flight * 0.5,
    aimTarget.x - p.x,
  );
  return {
    seq,
    ...movement,
    aim: p.mount && enemy ? leadAim(p, enemy, w.wind?.y ?? 0) : aim,
    attack,
    interact,
    block,
    dodge: c.boss && w.telegraph === 'shockwave' && w.bossTimer % 4 > 3,
    ability: attack && w.tick % 90 < 4,
  };
}
