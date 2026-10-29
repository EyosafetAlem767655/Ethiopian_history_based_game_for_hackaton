import { persistence } from './database';
import { db } from './store';
import { freshProgress } from '../../../packages/shared/src/game';
export async function leaderboard(demo: number) {
  const rows = (await db
    .prepare(
      persistence === 'supabase'
        ? 'SELECT id,name,progress FROM profiles WHERE demo=? ORDER BY safe_rating(progress) DESC,id LIMIT 30'
        : "SELECT id,name,progress FROM profiles WHERE demo=? ORDER BY CASE WHEN json_valid(progress) THEN CASE WHEN json_type(progress,'$.rating') IN ('integer','real') THEN json_extract(progress,'$.rating') ELSE 1000 END ELSE 1000 END DESC,id LIMIT 30",
    )
    .all(demo)) as {
    id: string;
    name: string;
    progress: string;
  }[];
  return rows.map((r) => {
    let progress;
    try {
      const parsed = JSON.parse(r.progress);
      progress =
        parsed && typeof parsed === 'object' ? { ...freshProgress(), ...parsed } : freshProgress();
    } catch {
      progress = freshProgress();
    }
    if (typeof progress.rating !== 'number' || !Number.isFinite(progress.rating))
      progress.rating = 1000;
    return { ...r, progress };
  });
}
