-- 20261003010000_usage.sql
-- Launch G: per-workspace daily usage caps on the paid API calls (vision, decide, workmap, voice).
-- Rollback: supabase/rollbacks/20261003010000_usage.down.sql
-- Never edit this file once applied. Later changes go in a new migration.
--
-- Members can read their workspace counters. Nobody writes the table directly: the only
-- write path is consume_usage, which checks membership and increments atomically.
-- The day is the current date in Europe/Zurich.

create table public.usage_counters (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('vision', 'decide', 'workmap', 'voice')),
  count int not null default 0,
  primary key (workspace_id, day, kind)
);

alter table public.usage_counters enable row level security;

revoke all on table public.usage_counters from public, anon;
grant select on table public.usage_counters to authenticated;

create policy usage_counters_select on public.usage_counters
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- True when the call is allowed (the counter was incremented), false when the cap is reached.
-- The on conflict ... where count < cap update is atomic: two concurrent calls at cap - 1
-- cannot both pass.
create function public.consume_usage(ws uuid, k text, cap int)
returns boolean
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Europe/Zurich')::date;
  n int;
begin
  if not public.is_workspace_member(ws) then
    raise exception 'not a member of workspace %', ws using errcode = '42501';
  end if;
  if k is null or k not in ('vision', 'decide', 'workmap', 'voice') then
    raise exception 'unknown usage kind %', k using errcode = '22023';
  end if;
  if cap is null or cap < 1 then
    return false;
  end if;
  insert into public.usage_counters as u (workspace_id, day, kind, count)
  values (ws, today, k, 1)
  on conflict (workspace_id, day, kind) do update
    set count = u.count + 1
    where u.count < cap
  returning u.count into n;
  return n is not null;
end;
$$;

revoke all on function public.consume_usage(uuid, text, int) from public, anon;
grant execute on function public.consume_usage(uuid, text, int) to authenticated;
