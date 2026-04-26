-- Add user_badges JSONB column to app_settings for in-app badge fallback
-- when World App push is unavailable (per Phase 4 daily-digest + mutual-push)
alter table public.app_settings add column if not exists user_badges jsonb not null default '{}'::jsonb;
