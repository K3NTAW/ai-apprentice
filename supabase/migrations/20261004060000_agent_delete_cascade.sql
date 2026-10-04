-- 20261004060000_agent_delete_cascade.sql
-- Deleting an agent deletes everything that belongs to it, in one statement.
-- Rollback: supabase/rollbacks/20261004060000_agent_delete_cascade.down.sql
-- Never edit this file once applied. Later changes go in a new migration.
--
-- Agent-owned rows and how they go with the agent row:
--   agents.settings (settings, shortcuts, guardrails)          column of the agent row
--   processes                                                  processes_agent_fkey on delete cascade (20261004030000)
--   process_versions                                           process_versions_process_fkey on delete cascade
--   sessions (capture, debrief, teach; teach progress)         sessions_agent_fkey on delete cascade (this file)
--   session_events, session_transcript, session_qa,
--   session_frames, processes_tombstones                       references public.sessions on delete cascade (init)
-- Kept on purpose (workspace level): agent_deletion_requests keeps agent_name, its agent_id goes null.
-- Sessions without an agent (agent_id null) are not touched.
--
-- Storage objects in the 'frames' bucket are not rows: the delete route removes them before the rows.
--
-- processes_tombstone: a process deleted together with its agent leaves no tombstone (its source session goes
-- with the agent too), so the trigger now also requires the agent row to still exist.

alter table public.sessions drop constraint if exists sessions_agent_fkey;

alter table public.sessions
  add constraint sessions_agent_fkey
  foreign key (workspace_id, agent_id) references public.agents (workspace_id, id)
  on delete cascade;

create or replace function public.processes_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source_session_id is not null
     and exists (select 1 from public.sessions s where s.id = old.source_session_id)
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id)
     and exists (select 1 from public.agents a where a.workspace_id = old.workspace_id and a.id = old.agent_id) then
    insert into public.processes_tombstones (source_session_id, workspace_id)
    values (old.source_session_id, old.workspace_id)
    on conflict (source_session_id) do nothing;
  end if;
  return old;
end
$$;

revoke all on function public.processes_tombstone() from public, anon, authenticated;
