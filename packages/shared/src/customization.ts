import { z } from 'zod';
import {
  CalendarDate,
  EthiopicCalendar,
  GregorianCalendar,
  toCalendar,
} from '@internationalized/date';

export const avatarSchema = z
  .object({
    version: z.literal(1),
    shape: z.enum(['round', 'oval', 'square']),
    skin: z.enum(['deep', 'brown', 'warm', 'tan', 'light']),
    eyes: z.enum(['almond', 'round', 'narrow']),
    brows: z.enum(['soft', 'bold', 'arched']),
    hair: z.enum(['cropped', 'curls', 'braids', 'bald']),
    beard: z.enum(['none', 'short', 'full']),
    // 'hero' wears the painted hero head from assets/heads.png; 'custom' draws the features above.
    // Avatars saved before this field existed parse as 'hero'.
    face: z.enum(['hero', 'custom']).default('hero'),
  })
  .strict();
export type AvatarSpec = z.infer<typeof avatarSchema>;
export const defaultAvatar: AvatarSpec = {
  version: 1,
  face: 'hero',
  shape: 'round',
  skin: 'brown',
  eyes: 'almond',
  brows: 'bold',
  hair: 'curls',
  beard: 'short',
};
export const ageBands = ['18–24', '25–34', '35–44', '45+'] as const;
export type AgeBand = (typeof ageBands)[number];
/** Unreviewed players share one 'guest' pool; reviewed adults stay in their own age band. */
export const GUEST_POOL = 'guest';
export type MatchPool = AgeBand | typeof GUEST_POOL;
export function isMatchPool(pool: unknown): pool is MatchPool {
  return pool === GUEST_POOL || ageBands.includes(pool as AgeBand);
}
export type ReviewStatus =
  | 'unsubmitted'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'resubmit'
  | 'withdrawn'
  | 'expired';
export interface AgeEligibility {
  status: ReviewStatus;
  band: AgeBand | null;
  label: string;
}
export const birthInput = z
  .object({
    year: z.number().int(),
    month: z.number().int(),
    day: z.number().int(),
    calendar: z.enum(['gregorian', 'ethiopian']),
  })
  .strict();
export function birthISO(input: z.infer<typeof birthInput>) {
  const v = birthInput.parse(input);
  if (v.year < 1800 || v.year > 2200) throw Error('Invalid birth year');
  const calendar = v.calendar === 'ethiopian' ? new EthiopicCalendar() : new GregorianCalendar();
  const d = new CalendarDate(calendar, v.year, v.month, v.day);
  // CalendarDate constrains overflowing inputs; reject instead of silently changing a document date.
  if (d.year !== v.year || d.month !== v.month || d.day !== v.day)
    throw Error('Invalid calendar date');
  return toCalendar(d, new GregorianCalendar()).toString();
}
export function ageBand(birth: string, now = new Date()): AgeBand | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  const [y, m, d] = birth.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d)
    return null;
  const today = new Date(now.getTime() + 3 * 3600000); // Addis Ababa calendar date.
  const age =
    today.getUTCFullYear() -
    y -
    Number(
      today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d),
    );
  return age < 18 || age > 120
    ? null
    : age <= 24
      ? ageBands[0]
      : age <= 34
        ? ageBands[1]
        : age <= 44
          ? ageBands[2]
          : ageBands[3];
}
// Fixed-length two-bone geometry keeps joints connected even at the highest knee lift.
export function joint(
  hip: { x: number; y: number },
  foot: { x: number; y: number },
  upper: number,
  lower: number,
  bend = 1,
) {
  const dx = foot.x - hip.x,
    dy = foot.y - hip.y;
  const length = Math.max(0.001, Math.min(upper + lower - 0.001, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx),
    offset = Math.acos(
      Math.max(
        -1,
        Math.min(1, (upper * upper + length * length - lower * lower) / (2 * upper * length)),
      ),
    );
  return {
    x: hip.x + Math.cos(base + offset * bend) * upper,
    y: hip.y + Math.sin(base + offset * bend) * upper,
  };
}
/**
 * Walk-to-run foot path. `run` (0 walk … 1 sprint) shortens ground contact so both feet leave the
 * ground (a flight phase), lengthens the stride and raises the knee. `roll` tilts the boot
 * heel-to-toe through stance and toe-up during the swing.
 */
export function runFoot(phase: number, run = 0, scale = 1) {
  const u = (((phase / (2 * Math.PI)) % 1) + 1) % 1,
    stance = 0.6 - 0.25 * run,
    reach = (16 + 6 * run) * scale,
    lift = (14 + 12 * run) * scale;
  if (u < stance) {
    const t = u / stance;
    return { x: reach - 2 * reach * t, y: 0, roll: -0.25 * t };
  }
  const t = (u - stance) / (1 - stance),
    eased = t * t * (3 - 2 * t);
  return {
    x: -reach + 2 * reach * eased,
    y: -Math.sin(Math.PI * t) * lift,
    roll: 0.35 * Math.sin(Math.PI * t) - 0.1,
  };
}
export function gaitFoot(phase: number, lift = 16) {
  const u = (((phase / (2 * Math.PI)) % 1) + 1) % 1;
  if (u < 0.6) return { x: 18 - (36 * u) / 0.6, y: 0 };
  const t = (u - 0.6) / 0.4;
  return { x: -18 + 36 * t, y: -Math.sin(Math.PI * t) * lift };
}
