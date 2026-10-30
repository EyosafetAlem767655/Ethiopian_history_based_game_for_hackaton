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
import { db } from './database';
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
  if (!row.path || !supabase) return;
  const out = await supabase.storage.from('age-evidence').remove([row.path]);
  if (!out.error)
    await db
      .prepare('UPDATE age_reviews SET path=NULL WHERE id=? AND path=?')
      .run(row.id, row.path);
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
      now = Date.now(),
      path = p.id + '/' + id;
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
        .run(id, p.id, 'pending', path, birth, now, now + 86400000);
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
      const saved = await db.transaction(async () => {
        const row = await db
          .prepare("SELECT * FROM age_reviews WHERE id=? AND player_id=? AND status='pending'")
          .get(q.params.id, r.locals.player.id);
        if (!supabase || !row || Number(row.expires) <= Date.now()) {
          r.status(403).json({ error: 'Submission expired or unavailable' });
          return;
        }
        const bytes = q.body;
        // Hold a row lock through upload: scheduled expiry must not delete/ack a path before its late upload finishes.
        const locked = await db
          .prepare(
            "UPDATE age_reviews SET status=status WHERE id=? AND status='pending' AND expires>?",
          )
          .run(row.id, Date.now());
        if (!locked.changes) {
          r.status(409).json({ error: 'Submission expired. Please resubmit.' });
          return;
        }
        const type = Buffer.isBuffer(bytes) ? imageType(bytes) : '';
        if (
          q.headers['x-document-consent'] !== 'true' ||
          !type ||
          type !== q.headers['content-type']
        ) {
          r.status(400).json({
            error: 'Consent and a valid JPEG, PNG or WebP image are required.',
          });
          return;
        }
        const out = await supabase.storage
          .from('age-evidence')
          .upload(row.path, bytes, { contentType: type, upsert: false, cacheControl: '0' });
        if (out.error) throw Error('Document upload failed. Withdraw and resubmit.');
        return { status: 'pending', label: 'Awaiting manual document review' };
      })();
      if (saved) r.json(saved);
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
    const saved = await db.transaction(async () => {
      const v = z
        .object({
          decision: z.enum(['approved', 'rejected', 'resubmit']),
          acknowledged: z.literal(true),
          birth: birthInput.optional(),
        })
        .strict()
        .parse(q.body);
      const row = await db
        .prepare("SELECT * FROM age_reviews WHERE id=? AND status='pending' AND expires>?")
        .get(q.params.id, Date.now());
      if (!row) {
        r.status(409).json({ error: 'This request is no longer pending.' });
        return;
      }
      const owner = await db
        .prepare('SELECT id,auth_id FROM hosted_identities WHERE id=?')
        .get(row.player_id);
      if (v.decision === 'approved' && (owner?.auth_id ?? owner?.id) === r.locals.reviewer) {
        r.status(403).json({ error: 'Another authorized reviewer must review your own document.' });
        return;
      }
      const birth = v.decision === 'approved' && v.birth ? birthISO(v.birth) : null;
      if (v.decision === 'approved') {
        if (!birth || !ageBand(birth))
          throw Error(
            'Review the complete calendar-confirmed date of birth; approval requires age 18+.',
          );
        const evidence = await supabase!.storage.from('age-evidence').download(row.path);
        if (evidence.error || !evidence.data)
          throw Error('Evidence has not been uploaded or is unavailable.');
      }
      const result = await db
        .prepare(
          "UPDATE age_reviews SET status=?,birth_date=?,reviewer=?,reviewed=? WHERE id=? AND status='pending' AND expires>?",
        )
        .run(v.decision, birth, r.locals.reviewer, Date.now(), row.id, Date.now());
      if (!result.changes) {
        r.status(409).json({ error: 'Request changed. Refresh before reviewing.' });
        return;
      }
      await deleteEvidence(row);
      return { status: v.decision, player: row.player_id as string };
    })();
    if (!saved) return;
    // Tell the player their eligibility, and release perks that were waiting on verification.
    await notify(saved.player, 'age-review', REVIEW_MESSAGES[saved.status], {
      status: saved.status,
    });
    if (saved.status === 'approved') await claimPendingPerks(saved.player);
    r.json({ status: saved.status });
  });
}
