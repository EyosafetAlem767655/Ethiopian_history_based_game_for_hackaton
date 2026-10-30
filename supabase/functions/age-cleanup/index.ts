import { createClient } from 'npm:@supabase/supabase-js@2';
Deno.serve(async (req) => {
  // This function is invoked by the database scheduler, never by a browser.
  const secret = Deno.env.get('AGE_CLEANUP_SECRET');
  if (!secret || req.headers.get('x-cleanup-secret') !== secret)
    return new Response('Forbidden', { status: 403 });
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const pending = await client.rpc('expired_age_evidence');
  if (pending.error) return Response.json({ ok: false }, { status: 500 });
  let deleted = 0;
  for (const row of pending.data ?? []) {
    const out = await client.storage.from('age-evidence').remove([row.path]);
    if (out.error) continue;
    const ack = await client.rpc('ack_age_evidence', { p_id: row.id, p_path: row.path });
    if (!ack.error) deleted++;
  }
  // Includes fenced late-upload reservations and gathering-photo withdrawals.
  const media = await client.rpc('pending_media_deletions');
  if (media.error) return Response.json({ok: false, deleted}, {status: 500});
  for (const row of media.data ?? []) {
    const out = await client.storage.from(row.bucket).remove([row.path]);
    if (out.error) continue;
    const ack = await client.rpc('ack_media_deletion', {p_bucket: row.bucket, p_path: row.path});
    if (!ack.error) deleted++;
  }
  return Response.json({ ok: true, deleted });
});
