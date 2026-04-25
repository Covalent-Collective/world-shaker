-- ===========================================================================
-- World Shaker — app_settings + llm_budget_ledger + rate_limit_buckets (US-004)
--
-- Source: .omc/plans/world-shaker-ux-v1-plan.md (v4) Step 1.3
--
-- Cost-cap value sizing rationale:
--   `cost_cap_usd_daily` overshoot tolerance =
--     max_concurrent_conversations × max_cost_per_conversation
--   Default $50.00 assumes 25 concurrent live conversations × $2.00 max
--   each = $50 worst-case overshoot beyond the cap before the synchronous
--   pre-flight check trips streaming_paused. Adjust per actual concurrency
--   ceiling and per-conversation token budget.
--
-- v4 residual fixes baked in:
--   * llm_budget_ledger has UNIQUE (conversation_id, turn_index) so
--     append_turn_with_ledger() (Step 2.7) can do an atomic ON CONFLICT
--     DO NOTHING upsert that pairs with conversation_turns UNIQUE; retries
--     never double-charge.
--   * match_weight_cosine + match_weight_struct columns added so
--     match_candidates() reads weights from app_settings instead of
--     hardcoded 0.6/0.4 (calibrated by scripts/calibrate-match-weights.ts
--     in Step 1.13).
--   * moderation_breaker_state JSONB stores shared circuit-breaker state
--     across Inngest invocations (Step 2.9 NSFW/hostile pipeline).
-- ===========================================================================

-- ---------- app_settings (single-row config) ----------------------------
create table if not exists public.app_settings (
  id                              int primary key default 1,
  streaming_paused                boolean        not null default false,
  cost_cap_usd_daily              numeric(10, 2) not null default 50.00,
  cost_cap_usd_per_user_daily     numeric(10, 2) not null default 1.00,
  match_weight_cosine             numeric(3, 2)  not null default 0.60,
  match_weight_struct             numeric(3, 2)  not null default 0.40,
  posthog_cohort_salt             text           not null,
  posthog_cohort_salt_rotated_at  timestamptz    not null default now(),
  moderation_breaker_state        jsonb          not null default '{}'::jsonb,
  constraint app_settings_singleton check (id = 1)
);

-- ---------- llm_budget_ledger (cost-cap source-of-truth) ---------------
create table if not exists public.llm_budget_ledger (
  id              bigserial primary key,
  user_id         uuid           not null references public.users(id) on delete cascade,
  conversation_id uuid           not null references public.conversations(id) on delete cascade,
  turn_index      int            not null,
  tokens_input    int            not null,
  tokens_output   int            not null,
  cost_usd        numeric(10, 6) not null,
  model           text           not null,
  occurred_at     timestamptz    not null default now(),
  unique (conversation_id, turn_index)
);

create index if not exists idx_llm_budget_ledger_user_occurred
  on public.llm_budget_ledger (user_id, occurred_at desc);

create index if not exists idx_llm_budget_ledger_occurred
  on public.llm_budget_ledger (occurred_at desc);

-- ---------- rate_limit_buckets (Postgres-backed sliding window) --------
create table if not exists public.rate_limit_buckets (
  world_user_id uuid        not null,
  bucket_key    text        not null,
  window_start  timestamptz not null,
  count         int         not null default 0,
  primary key (world_user_id, bucket_key, window_start)
);

create index if not exists idx_rate_limit_buckets_window_start
  on public.rate_limit_buckets (window_start);

-- ---------- RLS: all three service-role-only ----------------------------
alter table public.app_settings        enable row level security;
alter table public.llm_budget_ledger   enable row level security;
alter table public.rate_limit_buckets  enable row level security;
-- No policies. Service role bypasses RLS; no anon/authenticated access.

-- ---------- initial app_settings row -----------------------------------
-- gen_random_bytes() requires pgcrypto (loaded in 0001_initial.sql).
insert into public.app_settings (id, posthog_cohort_salt)
values (1, encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;
