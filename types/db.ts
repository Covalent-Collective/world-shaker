/**
 * Hand-written DB types (mirror of supabase/migrations/0001_initial.sql).
 * Replace with generated types via `npm run db:gen-types` once the Supabase
 * project is provisioned.
 */

export type AgentStatus = 'active' | 'paused' | 'suspended';

export type MatchStatus = 'pending' | 'accepted' | 'skipped' | 'mutual' | 'expired';

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
  verification_level: 'orb';
  created_at: string;
}

export interface Agent {
  id: string;
  user_id: string;
  interview_answers: Record<string, string>;
  extracted_features: Record<string, unknown>;
  embedding: number[] | null;
  status: AgentStatus;
  surface: 'dating'; // v2 will add: 'agora', etc.
  created_at: string;
}

export interface Conversation {
  id: string;
  agent_a_id: string;
  agent_b_id: string;
  turns: Array<{ speaker: 'A' | 'B'; text: string }>;
  surface: 'dating';
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
  status: MatchStatus;
  world_chat_link: string | null;
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
