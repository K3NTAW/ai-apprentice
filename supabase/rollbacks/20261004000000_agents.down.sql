-- 20261004000000_agents.down.sql
-- Rollback for supabase/migrations/20261004000000_agents.sql
--
-- Lossy: every agent and every session's link to an agent (sessions.agent_id) is deleted.
-- Sessions themselves stay. Safe to run twice: every drop uses if exists.
--
-- Order: policies and triggers on agents, the init sessions_guard_update (restored),
-- the sessions foreign key and indexes, the sessions.agent_id column, the agents table,
-- then the agents trigger functions.
--
-- When the migration was applied with supabase db push, also run
--   supabase migration repair --status reverted 20261004000000

do $$
begin
  if to_regclass('public.agents') is not null then
    drop policy if exists agents_select on public.agents;
    drop policy if exists agents_insert on public.agents;
    drop policy if exists agents_update on public.agents;
    drop policy if exists agents_delete on public.agents;
    drop trigger if exists agents_guard_update_trg on public.agents;
    drop trigger if exists agents_touch_updated_at_trg on public.agents;
  end if;
end
$$;

-- The init version, without the agent_id rule. Its trigger and grants stay as they are.
create or replace function public.sessions_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'sessions.id cannot change' using errcode = '42501';
  end if;
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'sessions.workspace_id cannot change' using errcode = '42501';
  end if;
  -- The only allowed change of created_by is to null without a user JWT
  -- (the on delete set null path when an auth user is deleted).
  if new.created_by is distinct from old.created_by
     and not (new.created_by is null and auth.uid() is null) then
    raise exception 'sessions.created_by cannot change' using errcode = '42501';
  end if;
  return new;
end
$$;

alter table if exists public.sessions drop constraint if exists sessions_agent_fkey;
drop index if exists public.sessions_workspace_agent_idx;
drop index if exists public.agents_workspace_created_idx;
alter table if exists public.sessions drop column if exists agent_id;
drop table if exists public.agents;
drop function if exists public.agents_touch_updated_at();
drop function if exists public.agents_guard_update();
