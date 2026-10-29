-- Run after deploying age-cleanup and setting its AGE_CLEANUP_SECRET.
-- Replace placeholders privately in the SQL editor; do not commit real secrets.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('https://YOUR-PROJECT.supabase.co','kibre_project_url');
select vault.create_secret('YOUR-RANDOM-CLEANUP-SECRET','kibre_cleanup_secret');
select cron.schedule('kibre-age-evidence-cleanup','0 * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='kibre_project_url')||'/functions/v1/age-cleanup',
  headers:=jsonb_build_object('Content-Type','application/json','X-Cleanup-Secret',(select decrypted_secret from vault.decrypted_secrets where name='kibre_cleanup_secret')),
  body:='{}'::jsonb
 );
$job$);
-- For an existing installation, update the named Vault entries rather than creating duplicates.
