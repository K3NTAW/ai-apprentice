-- 20261004060000_agent_delete_cascade.down.sql
-- Rollback for supabase/migrations/20261004060000_agent_delete_cascade.sql
--
-- Not lossy: rows deleted while the migration was applied stay deleted, nothing else changes.
-- Restores sessions_agent_fkey with on delete set null (agent_id) (sessions outlive their agent again) and the
-- 20261004030000 processes_tombstone. Safe to run twice.
--
-- When the migration was applied with supabase db push, also run
--   supabase migration repair --status reverted 20261004060000

alter table if exists public.sessions drop constraint if exists sessions_agent_fkey;

alter table if exists public.sessions
  add constraint sessions_agent_fkey
  foreign key (workspace_id, agent_id) references public.agents (workspace_id, id)
  on delete set null (agent_id);

create or replace function public.processes_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source_session_id is not null
     and exists (select 1 from public.sessions s where s.id = old.source_session_id)
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    insert into public.processes_tombstones (source_session_id, workspace_id)
    values (old.source_session_id, old.workspace_id)
    on conflict (source_session_id) do nothing;
  end if;
  return old;
end
$$;

revoke all on function public.processes_tombstone() from public, anon, authenticated;
