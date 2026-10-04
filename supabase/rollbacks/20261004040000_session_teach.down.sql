-- 20261004040000_session_teach.down.sql
-- Rollback for supabase/migrations/20261004040000_session_teach.sql
--
-- Lossy: drops every saved teach progress (sessions.teach). The Learners tab and the agent stats then show no
-- teach results and POST /api/session/[id]/teach answers 503. Safe to run twice: every drop uses if exists.
--
-- When the migration was applied with supabase db push, also run
--   supabase migration repair --status reverted 20261004040000

alter table if exists public.sessions drop constraint if exists sessions_teach_check;
alter table if exists public.sessions drop column if exists teach;
