import { postgresSQL } from './sql';
import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const persistence =
  process.env.PERSISTENCE ?? (process.env.SUPABASE_DB_URL ? 'supabase' : 'sqlite');
if (!['sqlite', 'supabase'].includes(persistence))
  throw Error('PERSISTENCE must be sqlite or supabase');
if (process.env.NODE_ENV === 'production' && persistence !== 'supabase')
  throw Error(
    'Production requires PERSISTENCE=supabase; ephemeral SQLite is not safe on free Render',
  );
if (persistence === 'supabase' && (!process.env.SUPABASE_DB_URL || !process.env.SESSION_SECRET))
  throw Error('Supabase persistence requires SUPABASE_DB_URL and a stable SESSION_SECRET');
if (persistence === 'supabase' && process.env.SESSION_SECRET!.length < 32)
  throw Error('SESSION_SECRET must contain at least 32 characters');
if (process.env.NODE_ENV === 'production') {
  if (
    !process.env.SUPABASE_URL ||
    !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
    throw Error('Production requires Supabase authentication/storage credentials on Render');
  // Optional when the server also serves the web app (same origin); required for a separate frontend.
  const origins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [];
  if (
    origins.some((origin) => {
      try {
        const u = new URL(origin.trim());
        return u.protocol !== 'https:' || u.origin !== origin.trim();
      } catch {
        return true;
      }
    })
  )
    throw Error('CORS_ORIGINS must list exact HTTPS frontend origins');
}

/** PEM from SUPABASE_DB_CA; dashboards often store newlines as literal "\n". */
export function supabaseCA() {
  return process.env.SUPABASE_DB_CA?.replace(/\\n/g, '\n') || undefined;
}

const file = process.env.DB_PATH ?? 'data/knights.sqlite';
if (persistence === 'sqlite' && file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
// Load the native better-sqlite3 binding only in sqlite mode so the Supabase/Render
// (node:22-bookworm-slim, no C toolchain) path never touches the native module.
const Database = persistence === 'sqlite' ? (await import('better-sqlite3')).default : null;
const sqlite = Database ? new Database(file) : null;
sqlite?.pragma('journal_mode = WAL');
const pg =
  persistence === 'supabase'
    ? postgres(process.env.SUPABASE_DB_URL!, {
        max: 4,
        prepare: false,
        // Supabase signs database certificates with its own root CA, which Node does not
        // trust by default. Supply it as SUPABASE_DB_CA (PEM) so full verification succeeds.
        ssl: { rejectUnauthorized: true, ca: supabaseCA() },
        connect_timeout: 15,
        connection: { application_name: 'kibre-gugs' },
      })
    : null;
const context = new AsyncLocalStorage<{ sql?: any; sqlite: boolean }>();
let tail: Promise<unknown> = Promise.resolve();
async function serialized<T>(fn: () => Promise<T>): Promise<T> {
  if (context.getStore()) return fn();
  const next = tail.then(fn, fn);
  tail = next.catch(() => {});
  return next;
}
async function query(sql: string, args: unknown[], kind: 'get' | 'all' | 'run') {
  if (pg) {
    const client = context.getStore()?.sql ?? pg;
    const rows = await client.unsafe(postgresSQL(sql), args);
    return kind === 'get' ? rows[0] : kind === 'all' ? [...rows] : { changes: rows.count };
  }
  return serialized(async () =>
    (sqlite!.prepare(sql)[kind] as (...values: unknown[]) => any)(...args),
  );
}
export const db = {
  prepare: (sql: string) => ({
    get: (...args: unknown[]): Promise<any> => query(sql, args, 'get'),
    all: (...args: unknown[]): Promise<any[]> => query(sql, args, 'all'),
    run: (...args: unknown[]): Promise<any> => query(sql, args, 'run'),
  }),
  async exec(sql: string) {
    if (!pg)
      await serialized(async () => {
        sqlite!.exec(sql);
      });
  },
  transaction<T>(fn: () => Promise<T> | T) {
    return async (): Promise<T> => {
      if (context.getStore()) return fn();
      if (pg)
        return pg.begin(async (sql) => {
          // Serialize authoritative state changes across processes and stale read/modify/write operations.
          await sql`select pg_advisory_xact_lock(731044830)`;
          return context.run({ sql, sqlite: false }, fn);
        }) as Promise<T>;
      return serialized(async () => {
        sqlite!.exec('BEGIN IMMEDIATE');
        try {
          const out = await context.run({ sqlite: true }, fn);
          sqlite!.exec('COMMIT');
          return out;
        } catch (e) {
          sqlite!.exec('ROLLBACK');
          throw e;
        }
      });
    };
  },
  async close() {
    if (pg) await pg.end();
    else sqlite?.close();
  },
};
export async function checkDatabase() {
  await db.prepare('SELECT id FROM profiles LIMIT 1').all();
  await db.prepare('SELECT digest FROM revoked_sessions LIMIT 1').all();
  await db.prepare('SELECT id FROM team_messages LIMIT 1').all();
  await db.prepare('SELECT revision,upload_path FROM gathering_sessions LIMIT 1').all();
  await db.prepare('SELECT upload_path FROM age_reviews LIMIT 1').all();
  await db.prepare('SELECT path FROM media_deletions LIMIT 1').all();
}
