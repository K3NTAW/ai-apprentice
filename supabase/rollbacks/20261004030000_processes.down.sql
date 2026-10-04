-- 20261004030000_processes.down.sql
-- Rollback for supabase/migrations/20261004030000_processes.sql
--
-- Lossy: every process, every process version, every tombstone and every session's link to a process
-- (sessions.process_id) is deleted. Sessions themselves stay, so the app falls back to the session-based process list.
-- The policies of both tables go with their tables. Safe to run twice: every drop uses if exists.
--
-- Order: the sessions foreign key, index and column,
-- create_process and update_process (they return the processes row type), workmap_valid, the process_versions
-- table, the processes table (its unique index processes_source_session_key and processes_tombstones_trg go with
-- it), the processes_tombstones table, then the trigger functions.
--
-- When the migration was applied with supabase db push, also run
--   supabase migration repair --status reverted 20261004030000

alter table if exists public.sessions drop constraint if exists sessions_process_fkey;
drop index if exists public.sessions_workspace_process_idx;
alter table if exists public.sessions drop column if exists process_id;
drop index if exists public.processes_workspace_agent_idx;
-- create_process and update_process return the processes row type, so they go before the table.
drop function if exists public.create_process(uuid, uuid, text, jsonb, text, boolean);
drop function if exists public.update_process(uuid, int, jsonb, text, text, text, boolean);
drop function if exists public.workmap_valid(jsonb);
drop table if exists public.process_versions;
drop table if exists public.processes;
drop index if exists public.processes_tombstones_workspace_idx;
drop table if exists public.processes_tombstones;
drop function if exists public.processes_tombstone();
drop function if exists public.process_versions_guard_update();
drop function if exists public.processes_touch_updated_at();
drop function if exists public.processes_guard_update();
