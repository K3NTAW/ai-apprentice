-- 20261004020000_workspace_create.down.sql
-- Rollback for supabase/migrations/20261004020000_workspace_create.sql
--
-- Lossy: every workspace city is deleted. Workspaces created through create_workspace stay, with their members.
-- Safe to run twice: every drop uses if exists.
--
-- When the migration was applied with supabase db push, also run
--   supabase migration repair --status reverted 20261004020000

drop function if exists public.create_workspace(text, text);

alter table public.workspaces drop constraint if exists workspaces_city_length;
alter table public.workspaces drop column if exists city;
