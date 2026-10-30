import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from './database';

await db.exec(
  `CREATE TABLE IF NOT EXISTS media_deletions(bucket TEXT NOT NULL,path TEXT NOT NULL,next_attempt INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(bucket,path));`,
);
export async function queueMediaDeletion(bucket: string, path: string | null, delay = 0) {
  if (path)
    await db
      .prepare('INSERT OR IGNORE INTO media_deletions(bucket,path,next_attempt) VALUES (?,?,?)')
      .run(bucket, path, Date.now() + delay);
}
export async function cancelMediaDeletion(bucket: string, path: string) {
  await db.prepare('DELETE FROM media_deletions WHERE bucket=? AND path=?').run(bucket, path);
}
export async function removeMedia(client: SupabaseClient, bucket: string, path: string | null) {
  if (!path) return;
  try {
    const result = await client.storage.from(bucket).remove([path]);
    if (!result.error)
      await db
        .prepare('DELETE FROM media_deletions WHERE bucket=? AND path=? AND next_attempt<=?')
        .run(bucket, path, Date.now());
  } catch {
    /* Durable deletion remains queued, including timed-out upload reservations. */
  }
}
let running = false;
export async function processMediaDeletions(client: SupabaseClient) {
  if (running) return;
  running = true;
  try {
    const jobs = await db
      .prepare('SELECT * FROM media_deletions WHERE next_attempt<=? ORDER BY next_attempt LIMIT 20')
      .all(Date.now());
    for (const row of jobs) {
      await removeMedia(client, row.bucket, row.path);
      await db
        .prepare(
          'UPDATE media_deletions SET attempts=attempts+1,next_attempt=? WHERE bucket=? AND path=?',
        )
        .run(
          Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(6, Number(row.attempts))),
          row.bucket,
          row.path,
        );
    }
  } finally {
    running = false;
  }
}
