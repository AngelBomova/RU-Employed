-- Run once in the Supabase SQL editor. No service-role key is used by the app.
create table if not exists public.candidate_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  materials jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table if not exists public.interview_reports (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), rubric_version text not null, report jsonb not null
);
create index if not exists reports_user_date on public.interview_reports(user_id, created_at desc);
create table if not exists public.interview_sessions (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null, expires_at timestamptz not null,
  lease_key uuid, lease_until timestamptz
);
create index if not exists sessions_user_expiry on public.interview_sessions(user_id, expires_at);
alter table public.candidate_profiles enable row level security;
alter table public.interview_reports enable row level security;
alter table public.interview_sessions enable row level security;
create policy profiles_owner on public.candidate_profiles for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy reports_owner on public.interview_reports for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sessions_owner on public.interview_sessions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.candidate_profiles, public.interview_reports, public.interview_sessions to authenticated;
revoke all on public.candidate_profiles, public.interview_reports, public.interview_sessions from anon;

-- Atomic leases prevent concurrent requests across separate server instances.
create or replace function public.claim_interview(target_id uuid, claim_key uuid)
returns setof public.interview_sessions language sql security invoker set search_path = public as $$
  update public.interview_sessions set lease_key = claim_key, lease_until = now() + interval '180 seconds'
  where id = target_id and user_id = (select auth.uid()) and expires_at > now()
    and (lease_until is null or lease_until < now()) returning *;
$$;
create or replace function public.save_interview(target_id uuid, claim_key uuid, new_payload jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.interview_sessions set payload = new_payload, lease_key = null, lease_until = null
  where id = target_id and user_id = (select auth.uid()) and lease_key = claim_key and lease_until > now();
  if not found then raise exception 'Interview lease expired or changed'; end if;
end;
$$;
revoke all on function public.claim_interview(uuid, uuid), public.save_interview(uuid, uuid, jsonb) from public;
grant execute on function public.claim_interview(uuid, uuid), public.save_interview(uuid, uuid, jsonb) to authenticated;
-- Schedule daily in Supabase pg_cron if enabled:
-- delete from public.interview_sessions where expires_at < now();
