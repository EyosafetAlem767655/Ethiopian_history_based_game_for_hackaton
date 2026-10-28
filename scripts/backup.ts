import 'dotenv/config';
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const source = resolve(process.env.DB_PATH ?? 'data/knights.sqlite');
const target = resolve(
  process.argv[2] ??
    `output/backups/knights-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
);
if (source === target || existsSync(target))
  throw Error('Choose a new backup destination; existing files are not overwritten.');
mkdirSync(dirname(target), { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
  console.log('Consistent SQLite backup created:', target);
} finally {
  db.close();
}
