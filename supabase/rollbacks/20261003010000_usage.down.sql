-- 20261003010000_usage.down.sql
-- Rollback for supabase/migrations/20261003010000_usage.sql
--
-- Deletes the daily usage counters. Safe to run twice.
-- The select policy on usage_counters goes with the table (drop table ... cascade).
--
-- When the migration was applied with supabase db push, also run
--   supabase migration repair --status reverted 20261003010000

drop function if exists public.consume_usage(uuid, text, int);
drop table if exists public.usage_counters cascade;
