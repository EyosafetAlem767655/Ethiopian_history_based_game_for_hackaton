import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { z } from 'zod';
import {
  avatarSchema,
  defaultAvatar,
  ageBand,
  birthISO,
  GUEST_POOL,
  isMatchPool,
  type MatchPool,
  birthInput,
  type AgeEligibility,
} from '../../../packages/shared/src/customization';
import { db, persistence } from './database';
import { queueMediaDeletion, cancelMediaDeletion, removeMedia } from './media';
import { supabase, isHosted } from './hosted';
import { notify } from './notify';
import { claimPendingPerks } from './store';
const REVIEW_MESSAGES: Record<string, string> = {
  approved:
    'Identity verified: you are eligible for adult matchmaking, the lunch perk and reserved rewards.',
  rejected: 'Identity review declined. Guest play continues; you may submit a clearer Fayda image.',
  resubmit: 'Identity review needs a clearer Fayda image. Please submit again.',
};

await db.exec(`CREATE TABLE IF NOT EXISTS avatars(player_id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS age_reviews(id TEXT PRIMARY KEY,player_id TEXT NOT NULL,status TEXT NOT NULL,path TEXT,birth_date TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL,reviewer TEXT,reviewed INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_review ON age_reviews(player_id) WHERE status='pending';`);
if (persistence === 'sqlite') {
  const columns = await db.prepare('PRAGMA table_info(age_reviews)').all();
  for (const [name, type] of [
    ['upload_path', 'TEXT'],
    ['upload_expires', 'INTEGER NOT NULL DEFAULT 0'],
  ])
    if (!columns.some((c) => c.name === name))
      await db.exec(`ALTER TABLE age_reviews ADD COLUMN ${name} ${type};`);
}
export async function readAvatar(id: string) {
  const row = await db.prepare('SELECT data FROM avatars WHERE player_id=?').get(id);
  try {
    return avatarSchema.parse(JSON.parse(row?.data ?? 'null'));
  } catch {
    return { ...defaultAvatar };
  }
}
export async function eligibility(id: string): Promise<AgeEligibility> {
  const row = await db
    .prepare('SELECT * FROM age_reviews WHERE player_id=? ORDER BY created DESC,id DESC LIMIT 1')
    .get(id);
  const status =
    row?.status === 'pending' && Number(row.expires) <= Date.now()
      ? 'expired'
      : (row?.status ?? 'unsubmitted');
  const band = status === 'approved' && (await isHosted(id)) ? ageBand(row.birth_date ?? '') : null;
  return {
    status,
    band,
    label: band
      ? '18+ — document reviewed'
      : 'Guest pool: you play other guests. Verify your identity to join adult age-band matchmaking.',
  };
}
/** The matchmaking pool a player belongs to: their reviewed age band, otherwise the guest pool. */
export async function matchPool(id: string): Promise<MatchPool> {
  return (await eligibility(id)).band ?? GUEST_POOL;
}
export async function assertHumanBand(id: string, band: unknown) {
  if (!isMatchPool(band) || (await matchPool(id)) !== band)
    throw Object.assign(
      Error(
        band === GUEST_POOL
          ? 'Reviewed adults play in their age band, not the guest pool.'
          : 'Adult matchmaking requires reviewed accounts in the same age band. Guests play in the guest pool.',
      ),
      { status: 403 },
    );
}
export async function assertParty(ids: string[]) {
  if (ids.length < 2) return;
  const pool = await matchPool(ids[0]);
  for (const id of ids)
    if ((await matchPool(id)) !== pool)
      throw Object.assign(
        Error(
          'Squads must share a matchmaking pool: all guests, or reviewed adults in the same age band.',
        ),
        { status: 403 },
      );
}
function imageType(bytes: Buffer) {
  if (bytes.length < 12) return '';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return '';
}
async function deleteEvidence(row: any) {
  if (!supabase) return;
  for (const path of [row.path, row.upload_path])
    if (path) {
      await queueMediaDeletion('age-evidence', path, path === row.upload_path ? 120000 : 0);
      await removeMedia(supabase, 'age-evidence', path);
    }
}
export function registerCustomization(app: Express) {
  app.put('/api/avatar', async (q, r) => {
    const spec = avatarSchema.parse(q.body);
    await db
      .prepare(
        'INSERT INTO avatars(player_id,data) VALUES (?,?) ON CONFLICT(player_id) DO UPDATE SET data=excluded.data',
      )
      .run(r.locals.player.id, JSON.stringify(spec));
    r.json({ avatar: spec });
  });
  app.get('/api/age-review', async (_q, r) =>
    r.json({
      ...(await eligibility(r.locals.player.id)),
      enabled: !!supabase && !!process.env.AGE_REVIEWER_IDS,
    }),
  );
  app.post('/api/age-review', async (q, r) => {
    const p = r.locals.player;
    if (!supabase || !process.env.AGE_REVIEWER_IDS) {
      r.status(503).json({
        error: 'Age review is not configured yet. Solo, bots and demo remain available.',
      });
      return;
    }
    if (p.demo || !(await isHosted(p.id))) {
      r.status(403).json({ error: 'Sign in with your Supabase account before submitting Fayda.' });
      return;
    }
    const v = z
      .object({ consent: z.literal(true), document: z.literal('fayda'), birth: birthInput })
      .strict()
      .parse(q.body);
    const birth = birthISO(v.birth);
    if (!ageBand(birth)) {
      r.status(403).json({ error: 'Human play is for adults aged 18 and older.' });
      return;
    }
    const id = randomUUID(),
      now = Date.now();
    await db.transaction(async () => {
      await db
        .prepare(
          "UPDATE age_reviews SET status='expired',birth_date=NULL WHERE player_id=? AND status='pending' AND expires<=?",
        )
        .run(p.id, now);
      const old = await db
        .prepare(
          "SELECT id FROM age_reviews WHERE player_id=? AND (status='pending' OR status='approved')",
        )
        .get(p.id);
      if (old) throw Error('Withdraw the previous submission before submitting another document.');
      await db
        .prepare(
          'INSERT INTO age_reviews(id,player_id,status,path,birth_date,created,expires) VALUES (?,?,?,?,?,?,?)',
        )
        .run(id, p.id, 'pending', null, birth, now, now + 86400000);
    })();
    await notify(
      p.id,
      'age-review',
      'ID submitted. A reviewer will check it and you will be notified of your eligibility.',
      { status: 'pending' },
    );
    r.json({ id, expires: now + 86400000 });
  });
  app.post(
    '/api/age-review/:id/evidence',
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
    async (q, r) => {
      const bytes = q.body;
      const type = Buffer.isBuffer(bytes) ? imageType(bytes) : '';
      if (
        !supabase ||
        q.headers['x-document-consent'] !== 'true' ||
        !type ||
        type !== q.headers['content-type']
      ) {
        r.status(400).json({ error: 'Consent and a valid JPEG, PNG or WebP image are required.' });
        return;
      }
      const expires = Date.now() + 120000;
      const reservation = await db.transaction(async () => {
        const row = await db
          .prepare("SELECT * FROM age_reviews WHERE id=? AND player_id=? AND status='pending'")
          .get(q.params.id, r.locals.player.id);
        if (
          !row ||
          Number(row.expires) <= Date.now() ||
          row.path ||
          (row.upload_path && Number(row.upload_expires) > Date.now())
        )
          throw Error('Submission expired, already uploaded, or upload in progress');
        const path = row.player_id + '/' + row.id + '/' + randomUUID();
        await queueMediaDeletion('age-evidence', path, 120000);
        await db
          .prepare('UPDATE age_reviews SET upload_path=?,upload_expires=? WHERE id=?')
          .run(path, expires, row.id);
        return { id: row.id, path };
      })();
      try {
        const out = await supabase.storage
          .from('age-evidence')
          .upload(reservation.path, bytes, { contentType: type, upsert: false, cacheControl: '0' });
        if (out.error) throw Error('Document upload failed. Withdraw and resubmit.');
        await db.transaction(async () => {
          if (expires <= Date.now()) throw Error('Upload expired. Please retry.');
          const result = await db
            .prepare(
              "UPDATE age_reviews SET path=?,upload_path=NULL,upload_expires=0 WHERE id=? AND upload_path=? AND status='pending' AND expires>?",
            )
            .run(reservation.path, reservation.id, reservation.path, Date.now());
          if (!result.changes) throw Error('Upload was cancelled, reviewed or expired');
          await cancelMediaDeletion('age-evidence', reservation.path);
        })();
        r.json({ status: 'pending', label: 'Awaiting manual document review' });
      } catch (e) {
        await db
          .prepare(
            'UPDATE age_reviews SET upload_path=NULL,upload_expires=0 WHERE id=? AND upload_path=?',
          )
          .run(reservation.id, reservation.path);
        await removeMedia(supabase, 'age-evidence', reservation.path);
        throw e;
      }
    },
  );
  app.delete('/api/age-review', async (_q, r) => {
    const rows = await db.transaction(async () => {
      const rows = await db
        .prepare('SELECT * FROM age_reviews WHERE player_id=?')
        .all(r.locals.player.id);
      await db
        .prepare("UPDATE age_reviews SET status='withdrawn',birth_date=NULL WHERE player_id=?")
        .run(r.locals.player.id);
      return rows;
    })();
    for (const row of rows) await deleteEvidence(row);
    r.json({ withdrawn: true });
  });
  app.use('/api/admin/age-reviews', async (q, r, next) => {
    const jwt = q.headers['x-review-token'];
    if (!supabase || typeof jwt !== 'string') {
      r.status(403).json({ error: 'Reviewer sign-in with MFA required' });
      return;
    }
    const { data, error } = await supabase.auth.getUser(jwt);
    const allowed = (process.env.AGE_REVIEWER_IDS ?? '').split(',').map((x) => x.trim());
    let aal = '';
    try {
      aal = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).aal;
    } catch {}
    if (error || !data.user || !allowed.includes(data.user.id) || aal !== 'aal2') {
      r.status(403).json({
        error: 'An authorized reviewer with a current MFA session is required.',
      });
      return;
    }
    r.locals.reviewer = data.user.id;
    next();
  });
  app.get('/api/admin/age-reviews', async (_q, r) => {
    const rows = await db
      .prepare(
        "SELECT * FROM age_reviews WHERE status='pending' AND expires>? ORDER BY created LIMIT 50",
      )
      .all(Date.now());
    r.setHeader('Cache-Control', 'no-store');
    r.json(
      await Promise.all(
        rows.map(async (row) => {
          const out = await supabase!.storage.from('age-evidence').createSignedUrl(row.path, 60);
          return {
            id: row.id,
            birth: row.birth_date,
            created: row.created,
            photoUrl: out.data?.signedUrl ?? null,
          };
        }),
      ),
    );
  });
  app.post('/api/admin/age-reviews/:id', async (q, r) => {
    const v = z
      .object({
        decision: z.enum(['approved', 'rejected', 'resubmit']),
        acknowledged: z.literal(true),
        birth: birthInput.optional(),
      })
      .strict()
      .parse(q.body);
    const birth = v.decision === 'approved' && v.birth ? birthISO(v.birth) : null;
    const snapshot = await db
      .prepare("SELECT * FROM age_reviews WHERE id=? AND status='pending' AND expires>?")
      .get(q.params.id, Date.now());
    if (!snapshot) {
      r.status(409).json({ error: 'This request is no longer pending.' });
      return;
    }
    if (v.decision === 'approved') {
      if (!birth || !ageBand(birth))
        throw Error('Review the complete calendar-confirmed adult birth date.');
      if (!snapshot.path || snapshot.upload_path) {
        r.status(409).json({ error: 'Evidence has not finished uploading.' });
        return;
      }
      const evidence = await supabase!.storage.from('age-evidence').download(snapshot.path);
      if (evidence.error || !evidence.data) throw Error('Evidence is unavailable.');
    }
    const saved = await db.transaction(async () => {
      const row = await db
        .prepare("SELECT * FROM age_reviews WHERE id=? AND status='pending' AND expires>?")
        .get(q.params.id, Date.now());
      if (!row || (v.decision === 'approved' && (row.path !== snapshot.path || row.upload_path)))
        throw Object.assign(Error('Request changed. Refresh before reviewing.'), { status: 409 });
      const owner = await db
        .prepare('SELECT id,auth_id FROM hosted_identities WHERE id=?')
        .get(row.player_id);
      if (v.decision === 'approved' && (owner?.auth_id ?? owner?.id) === r.locals.reviewer) {
        r.status(403).json({ error: 'Another authorized reviewer must review your own document.' });
        return;
      }
      await queueMediaDeletion('age-evidence', row.path);
      await queueMediaDeletion('age-evidence', row.upload_path, 120000);
      await db
        .prepare(
          'UPDATE age_reviews SET status=?,birth_date=?,reviewer=?,reviewed=?,path=NULL,upload_path=NULL,upload_expires=0 WHERE id=?',
        )
        .run(v.decision, birth, r.locals.reviewer, Date.now(), row.id);
      return row;
    })();
    if (saved) {
      await deleteEvidence(saved);
      // Tell the player their eligibility, and release perks that were waiting on verification.
      await notify(saved.player_id, 'age-review', REVIEW_MESSAGES[v.decision], {
        status: v.decision,
      });
      if (v.decision === 'approved') await claimPendingPerks(saved.player_id);
      r.json({ status: v.decision });
    }
  });
}
