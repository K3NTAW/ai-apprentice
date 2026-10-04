-- 20261004010000_agent_settings.down.sql
-- Rollback for supabase/migrations/20261004010000_agent_settings.sql
--
-- Lossy: drops every stored agent setting (agents.settings), every deletion request and every deletion report.
-- Agents fall back to the default settings in src/lib/agents/settings.ts. Safe to run twice: every drop uses if exists.
-- The policies of both tables go with their tables.
--
-- When the migration was applied with supabase db push, also run
--   supabase migration repair --status reverted 20261004010000

drop table if exists public.agent_reports;
drop table if exists public.agent_deletion_requests;
drop function if exists public.agent_deletion_requests_guard_update();
drop function if exists public.agent_settings_patch(uuid, uuid, jsonb);
alter table if exists public.agents drop constraint if exists agents_settings_check;
alter table if exists public.agents drop column if exists settings;
