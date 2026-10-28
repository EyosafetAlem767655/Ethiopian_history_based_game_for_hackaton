import type { Biome, Geometry } from './presentation';
export const CAMPAIGN_VERSION = 1;
export type MissionKind =
  | 'oath'
  | 'ride'
  | 'landmarks'
  | 'joust'
  | 'courier'
  | 'conquest'
  | 'escort'
  | 'rescue'
  | 'capture'
  | 'beacons'
  | 'artifacts'
  | 'symbols'
  | 'mirrors'
  | 'guardian'
  | 'throne';
export interface MissionDefinition {
  id: number;
  chapter: number;
  name: string;
  kind: MissionKind;
  biome: Biome;
  minutes: number;
  mounted: boolean;
  guide: string;
}
export const MISSIONS: MissionDefinition[] = [
  {
    id: 1,
    chapter: 1,
    name: 'Shewa · The Shield Oath',
    kind: 'oath',
    biome: 'sandstone',
    minutes: 4,
    mounted: false,
    guide:
      'Keep the young standard-bearer alive. Face incoming strikes with your shield, then defeat the challengers.',
  },
  {
    id: 2,
    chapter: 1,
    name: 'Entoto · Highland Riding',
    kind: 'ride',
    biome: 'highland',
    minutes: 3,
    mounted: true,
    guide:
      'Ride through the golden rings in order. Build speed on the straight and release movement to brake before turning.',
  },
  {
    id: 3,
    chapter: 1,
    name: 'Ankober · The Mist Path',
    kind: 'landmarks',
    biome: 'mist',
    minutes: 3,
    mounted: false,
    guide:
      'Visit each illuminated landmark and read its inscription with E. Their clues reveal the order of the gate seals.',
  },
  {
    id: 4,
    chapter: 1,
    name: 'Wollo · Spears in the Wind',
    kind: 'joust',
    biome: 'wind',
    minutes: 3,
    mounted: true,
    guide:
      'Six passes. One spear throw each per pass. Ride, aim ahead of your rival, and block with the right mouse button.',
  },
  {
    id: 5,
    chapter: 1,
    name: 'Gojjam · The Stranded Courier',
    kind: 'courier',
    biome: 'mud',
    minutes: 4,
    mounted: true,
    guide:
      'Find the stranded courier. Hold E nearby to rescue them, then protect their route through the muddy checkpoints.',
  },
  {
    id: 6,
    chapter: 2,
    name: 'Arsi · Banner Conquest',
    kind: 'conquest',
    biome: 'grassland',
    minutes: 3,
    mounted: false,
    guide:
      'Stand inside a banner circle to capture it. Hold more ground than the crimson squad before the horn sounds.',
  },
  {
    id: 7,
    chapter: 2,
    name: 'Abay · The Banner Crossing',
    kind: 'escort',
    biome: 'river',
    minutes: 4,
    mounted: false,
    guide:
      'Stay near the banner bearer to move the escort. Clear each checkpoint and revive the bearer with E if they fall.',
  },
  {
    id: 8,
    chapter: 2,
    name: 'Wollo · The Rescue',
    kind: 'rescue',
    biome: 'wind',
    minutes: 4,
    mounted: false,
    guide:
      'Break the shadow guard and hold E beside each captive. Protect the rescued travelers as they reach safety.',
  },
  {
    id: 9,
    chapter: 2,
    name: 'Gondar · The Stolen Standard',
    kind: 'capture',
    biome: 'citadel',
    minutes: 4,
    mounted: false,
    guide:
      'Take the crimson standard with E and carry it to your emerald base. Defend your own banner between raids.',
  },
  {
    id: 10,
    chapter: 2,
    name: 'Harar · Night Watch',
    kind: 'beacons',
    biome: 'night',
    minutes: 4,
    mounted: false,
    guide:
      'Read the watchtower clues and kindle the beacons in the revealed order. Then defend the light against the shadows.',
  },
  {
    id: 11,
    chapter: 3,
    name: 'The Missing Seal',
    kind: 'artifacts',
    biome: 'citadel',
    minutes: 3,
    mounted: false,
    guide:
      'Three royal artifacts lie along guarded paths. Approach each seal and press E to restore the sanctuary.',
  },
  {
    id: 12,
    chapter: 3,
    name: 'The Four Symbols',
    kind: 'symbols',
    biome: 'observatory',
    minutes: 3,
    mounted: false,
    guide:
      'The scroll reveals a new sequence for this expedition. Approach the matching pillars and press E in order.',
  },
  {
    id: 13,
    chapter: 3,
    name: 'The Sun and Moon Observatory',
    kind: 'mirrors',
    biome: 'observatory',
    minutes: 3,
    mounted: false,
    guide:
      'Rotate the three mirrors with E until each beam reaches its marked receiver. Solve all three constellations.',
  },
  {
    id: 14,
    chapter: 3,
    name: 'The Guardian’s Gauntlet',
    kind: 'guardian',
    biome: 'citadel',
    minutes: 5,
    mounted: false,
    guide:
      'Survive the wardens and shadow hunters. The lion guardian will emerge when its sentinels are broken.',
  },
  {
    id: 15,
    chapter: 3,
    name: 'The Eclipse Throne',
    kind: 'throne',
    biome: 'throne',
    minutes: 6,
    mounted: false,
    guide:
      'The most honored warrior challenges the King first. When the Eclipse Crown awakens, all four must fight together.',
  },
];
export const DEMO_MISSIONS = [1, 2, 6, 8, 12, 14, 15];
export interface CampaignProgress {
  version: number;
  completed: number[];
  fellowship: boolean;
  honor: number;
  contribution: number;
}
export const freshCampaign = (): CampaignProgress => ({
  version: CAMPAIGN_VERSION,
  completed: [],
  fellowship: false,
  honor: 0,
  contribution: 0,
});
export function nextMission(progress: CampaignProgress, demo: boolean) {
  return (
    (demo ? DEMO_MISSIONS : MISSIONS.map((m) => m.id)).find(
      (id) => !progress.completed.includes(id),
    ) ?? null
  );
}
export function missionEligibility(progress: CampaignProgress, id: number, demo: boolean) {
  const order = demo ? DEMO_MISSIONS : MISSIONS.map((m) => m.id),
    index = order.indexOf(id);
  if (index < 0) return 'This mission is not part of this journey.';
  if (order.slice(0, index).some((n) => !progress.completed.includes(n)))
    return 'Complete the preceding campaign missions first.';
  if (MISSIONS[id - 1].chapter === 3 && !progress.fellowship)
    return 'Complete the Royal Gathering before entering the citadel.';
  return null;
}
export function completeMission(
  progress: CampaignProgress,
  id: number,
  honor: number,
  contribution = 0,
) {
  if (progress.completed.includes(id)) return { ...progress, completed: [...progress.completed] };
  return {
    ...progress,
    completed: [...progress.completed, id].sort((a, b) => a - b),
    honor: progress.honor + Math.min(100, Math.max(0, honor)),
    contribution: (progress.contribution ?? 0) + Math.min(1000, Math.max(0, contribution)),
  };
}
export function missionGeometry(m: MissionDefinition): Geometry {
  const large = ['landmarks', 'courier', 'escort', 'rescue', 'artifacts'].includes(m.kind);
  const width = large ? 1680 : 1200,
    height = large ? 1080 : 760;
  const obstacles: Geometry['obstacles'] =
    m.kind === 'ride' || m.kind === 'joust'
      ? []
      : [
          { x: 350, y: 250, w: 85, h: 65 },
          { x: 780, y: 480, w: 95, h: 65 },
          { x: 800, y: 240, w: 60, h: 80 },
          ...(large
            ? [
                { x: 1180, y: 650, w: 110, h: 90 },
                { x: 1100, y: 250, w: 100, h: 65 },
                { x: 490, y: 740, w: 100, h: 65 },
              ]
            : []),
        ];
  if (m.biome === 'river') {
    obstacles.splice(
      0,
      obstacles.length,
      { x: 730, y: 80, w: 200, h: 320, kind: 'water' },
      { x: 730, y: 530, w: 200, h: height - 610, kind: 'water' },
    );
  }
  return { width, height, obstacles, friction: m.biome === 'mud' ? 0.62 : 1 };
}
export const rankFor = (completed: number) =>
  completed >= 15
    ? 'Crown Champion'
    : completed >= 10
      ? 'Ras'
      : completed >= 5
        ? 'Dejazmach'
        : completed >= 3
          ? 'Balambaras'
          : 'Wotader';
