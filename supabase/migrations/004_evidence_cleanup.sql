-- Only service-to-service functions can enumerate or acknowledge evidence deletion.
create or replace function public.expired_age_evidence() returns table(id text,path text)
language plpgsql security definer set search_path=pg_catalog as $$ begin
 update game_runtime.age_reviews set status='expired',birth_date=null
 where status='pending' and expires <= extract(epoch from clock_timestamp())*1000;
 return query select r.id,r.path from game_runtime.age_reviews r where r.path is not null and r.status<>'pending' limit 100;
end $$;
create or replace function public.ack_age_evidence(p_id text,p_path text) returns void
language sql security definer set search_path=pg_catalog as $$
 update game_runtime.age_reviews set path=null where id=p_id and path=p_path and status<>'pending';
$$;
revoke all on function public.expired_age_evidence() from public,anon,authenticated;
revoke all on function public.ack_age_evidence(text,text) from public,anon,authenticated;
grant execute on function public.expired_age_evidence() to service_role;
grant execute on function public.ack_age_evidence(text,text) to service_role;
