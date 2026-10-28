import { campaignWorld, equipCampaign, stepCampaign } from '../packages/shared/src/campaign';
import { MISSIONS } from '../packages/shared/src/missions';
import { fighter } from '../packages/shared/src/game';
import { campaignControl } from '../tests/campaign-controller';
const demo = !process.argv.includes('--normal');
for (const m of MISSIONS) {
  const w = campaignWorld(m.id, demo, 71);
  w.players = [equipCampaign(fighter('human', 'Judge', 0, false, 0, 'guardian'), w)];
  if (m.kind !== 'joust')
    for (let n = 1; n < 4; n++)
      w.players.push(
        equipCampaign(
          fighter(
            'bot' + n,
            'AI' + n,
            0,
            true,
            n,
            (['guardian', 'spear', 'archer', 'rider'] as const)[n],
          ),
          w,
        ),
      );
  let seconds = 0;
  for (let n = 0; n < 30000 && !w.finished; n++) {
    stepCampaign(w, new Map([['human', campaignControl(w, 'human', n)]]));
    seconds += 1 / 30;
  }
  console.log(
    JSON.stringify({
      id: m.id,
      name: m.name,
      seconds: Math.round(seconds),
      finished: w.finished,
      winner: w.winner,
      phase: w.phase,
      score:w.scores,
      markers: w.campaign!.markers.map((a) => [a.id, a.done, a.value]),
      hp: w.players
        .filter((p) => p.team === 0)
        .map((p) => [p.id, Math.round(p.hp), Math.round(p.x), Math.round(p.y)]),
      enemies: w.players
        .filter((p) => p.team === 1 && p.hp > 0)
        .map((p) => [p.kind, Math.round(p.hp), Math.round(p.x), Math.round(p.y)]),
      objective: w.campaign!.objective,
    }),
  );
}
