/**
 * Hand-written DB types (mirror of supabase/migrations/0001_initial.sql +
 * 0003_ux_v1.sql + 0004_conversation_turns.sql + 0006_app_settings.sql).
 *
 * Replace with generated types via `npm run db:gen-types` once the Supabase
 * project is provisioned (see Step 5.6 in world-shaker-ux-v1-plan.md).
 */

export type AgentStatus = 'active' | 'paused' | 'suspended';

export type MatchStatus = 'pending' | 'accepted' | 'skipped' | 'mutual' | 'expired';

export type LanguagePref = 'ko' | 'en';

export type MatchOrigin = 'system_generated' | 'user_initiated_proactive' | 'encounter_spawned';

export type ConversationStatus = 'live' | 'completed' | 'abandoned' | 'failed';

export type ModerationStatus = 'pending' | 'clean' | 'flagged' | 'dropped';

export type OutcomeEventType =
  | 'viewed'
  | 'accepted'
  | 'skipped'
  | 'mutual'
  | 'chat_opened'
  | 'replied_24h'
  | 'met_confirmed'
  | 'safety_yes'
  | 'safety_mixed'
  | 'safety_no'
  | 'wont_connect'
  | 'vouched'
  | 'report_filed';

export interface User {
  id: string;
  nullifier: string;
  action: string;
  wallet_address: string | null;
  world_username: string | null;
  /** Stored as TEXT + CHECK; only 'orb' permitted in v1. */
  verification_level: 'orb';
  /** Added in 0003_ux_v1.sql. Defaults to 'ko'. */
  language_pref: LanguagePref;
  /** Added in 0003_ux_v1.sql. Defaults to 'Asia/Seoul'. */
  timezone: string;
  /** Added in 0003_ux_v1.sql. Populated by lib/posthog/cohort.ts hash helper. */
  posthog_cohort: string | null;
  created_at: string;
}

export interface AuthNonce {
  nonce_hash: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface Agent {
  id: string;
  user_id: string;
  interview_answers: Record<string, string>;
  extracted_features: Record<string, unknown>;
  embedding: number[] | null;
  status: AgentStatus;
  surface: 'dating'; // v2 will add: 'agora', etc.
  /** Added in 0003_ux_v1.sql. */
  avatar_url: string | null;
  /** Added in 0003_ux_v1.sql. */
  avatar_generated_at: string | null;
  /** Added in 0003_ux_v1.sql. NULL means follow user's language_pref. */
  language_pref: LanguagePref | null;
  /** Added in 0003_ux_v1.sql. Marks alpha-stage seed personas (Step 4.6). */
  is_seed: boolean;
  /** Added in 0003_ux_v1.sql. Append-only growth events for Living Agent. */
  growth_log: Array<Record<string, unknown>>;
  created_at: string;
}

export interface Conversation {
  id: string;
  agent_a_id: string;
  agent_b_id: string;
  /**
   * `turns` JSONB column was dropped in 0004_conversation_turns.sql.
   * Read individual turns from the `conversation_turns` table via the
   * SSE relay route (service-role only).
   */
  surface: 'dating';
  /** Added in 0003_ux_v1.sql. */
  status: ConversationStatus;
  /** Added in 0003_ux_v1.sql. Increments on retry under same (surface, pair_key). */
  attempt_number: number;
  /** Added in 0003_ux_v1.sql. Bumped on every turn write for SSE bookkeeping. */
  last_turn_emitted_at: string | null;
  created_at: string;
}

export interface ConversationTurn {
  /** BIGSERIAL — serialized as number; safe up to Number.MAX_SAFE_INTEGER. */
  id: number;
  conversation_id: string;
  /** Monotonic per conversation, starts at 0. */
  turn_index: number;
  speaker_agent_id: string;
  text: string;
  moderation_status: ModerationStatus;
  token_count: number | null;
  created_at: string;
}

export interface Match {
  id: string;
  user_id: string;
  candidate_user_id: string;
  conversation_id: string | null;
  compatibility_score: number;
  why_click: string | null;
  watch_out: string | null;
  highlight_quotes: Array<{ speaker: 'A' | 'B'; text: string }>;
  rendered_transcript: Array<{ speaker: 'A' | 'B'; text: string }>;
  status: MatchStatus;
  world_chat_link: string | null;
  /** Added in 0003_ux_v1.sql. */
  origin: MatchOrigin;
  /** Added in 0003_ux_v1.sql. Pre-generated first-message starter cache. */
  starters: Array<{ text: string }> | null;
  /** Added in 0003_ux_v1.sql. Marks rows produced by the first-encounter pipeline. */
  first_encounter: boolean;
  created_at: string;
  accepted_at: string | null;
  expires_at: string;
}

export interface OutcomeEvent {
  id: string;
  user_id: string;
  match_id: string | null;
  event_type: OutcomeEventType;
  source_screen: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Report {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: 'harassment' | 'hateful' | 'catfish' | 'underage' | 'nsfw' | 'spam' | 'other';
  detail: string | null;
  created_at: string;
}

/**
 * Single-row config table (id = 1). Created in 0006_app_settings.sql.
 * Service-role-only — never queried from the client.
 */
export interface AppSettings {
  id: 1;
  streaming_paused: boolean;
  cost_cap_usd_daily: string;
  cost_cap_usd_per_user_daily: string;
  match_weight_cosine: string;
  match_weight_struct: string;
  posthog_cohort_salt: string;
  posthog_cohort_salt_rotated_at: string;
  /**
   * Keyed by provider name (e.g. 'openrouter:omni-moderation-latest'):
   *   { failures: number; opened_at: string }
   */
  moderation_breaker_state: Record<string, { failures: number; opened_at: string } | undefined>;
}

/**
 * Source-of-truth for cost-cap enforcement (AC-23). Created in
 * 0006_app_settings.sql. Service-role-only.
 *
 * NUMERIC columns are serialized as strings by supabase-js to preserve
 * precision; cast to Number at the call site.
 */
export interface LlmBudgetLedger {
  id: number;
  user_id: string;
  conversation_id: string;
  turn_index: number;
  tokens_input: number;
  tokens_output: number;
  cost_usd: string;
  model: string;
  occurred_at: string;
}

/**
 * Postgres-backed sliding-window rate limiter buckets. Created in
 * 0006_app_settings.sql. Service-role-only.
 */
export interface RateLimitBucket {
  world_user_id: string;
  bucket_key: string;
  window_start: string;
  count: number;
}
