-- Additive upgrade for existing 001 installations. Do not recreate the original schema.
create table if not exists public.campaign_progress (
 player_id uuid primary key references public.profiles(id) on delete cascade,
 data jsonb not null default '{"version":1,"completed":[],"fellowship":false,"honor":0}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.campaign_progress enable row level security;
drop policy if exists own_campaign on public.campaign_progress;
create policy own_campaign on public.campaign_progress for select to authenticated using(player_id=auth.uid());
-- All campaign completion is validated by the authoritative game server.
create or replace function public.commit_campaign(
 p_id text,p_payload jsonb,p_hash text,p_players jsonb,p_badges jsonb,p_status text,p_campaign jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare item jsonb; inserted boolean; begin
 inserted:=public.commit_match(p_id,p_payload,p_hash,p_players,p_badges,p_status);
 if not inserted then return false; end if;
 for item in select * from jsonb_array_elements(p_campaign) loop
 insert into public.campaign_progress(player_id,data,updated_at) values((item->>'player_id')::uuid,item->'data',now())
 on conflict(player_id) do update set data=excluded.data,updated_at=excluded.updated_at;
 end loop;
 return true;
end $$;
revoke all on function public.commit_campaign(text,jsonb,text,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_campaign(text,jsonb,text,jsonb,jsonb,text,jsonb) to service_role;
