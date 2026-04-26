# World Shaker

World Shaker is a Worldcoin MiniApp dating product built exclusively for verified humans (World ID orb-verified). Its S-grade differentiator is **live agent-to-agent dialogue** — two AI personas drawn from both users' interview answers converse in real time while users watch, producing a curated compatibility report with highlight quotes, a `why_click` summary, and a `watch_out` note. Tech stack: Next.js 15 (App Router), Supabase Postgres + pgvector + RLS, Inngest (streaming orchestration), OpenRouter (Claude Sonnet 4.6 chat + OpenAI text-embedding-3-small), PostHog (LLM analytics + session replay), deployed on Vercel.

---

## Implementation Status

| Phase                                              | Summary                                                                                                                                                                                                                                                                                                                                                                                           | Status      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Phase 1 — Foundation                               | Schema migrations 0003–0006 (conversation_turns, app_settings, llm_budget_ledger, match_candidates SQL fn), i18n shell (KR+EN), VerifiedHumanBadge, PostHog cohort hashing, daily quota helper, rate-limit middleware, HNSW recall validation, safety eval corpus, match-weight calibration scripts                                                                                               | Done        |
| Phase 2 — S-grade conversation core                | Persona + agent-dialogue + report + first-message + interview-probe prompts (KR-only), streaming gateway (OpenRouter), live-conversation Inngest fn (atomic turn+ledger write, cost-cap preflight, advisory-lock restart), SSE relay route (Supabase Realtime backed, Last-Event-ID resume), safety pipeline (repeat-loop/NSFW/hostile, shared circuit-breaker), report Inngest fn, abandon route | Done        |
| Phase 3 — Loops (interview, stroll, match flow)    | Verify + intro routes, interview UX (resumable), avatar generation (one-shot; placeholder fallback if no image model), first-encounter Inngest fn + recovery path, conversation viewer (LiveTranscript + FailureOverlay), match/report viewer, like/skip server action, mutual-match success screen, Daily Stroll card stack                                                                      | Done        |
| Phase 4 — Notifications + ops                      | World App push (daily-digest morning + mutual-match impact-only; WORLD_APP_PUSH_ENABLED gate), in-app badge fallback, seed-agent pool migration (0007_seed_agents), user-badges migration (0008), match-candidates v2 (0009) + seed-include fix (0010), audit-outcome-events script, smoke-conversation script, inject-fault script, cost-cap Slack alert (SLACK_WEBHOOK_URL)                     | Done        |
| Phase 5 — Polish + EN prompt rendering + ship-gate | Avatar policy (one-shot, documented), badge placement audit, copy-tone scaffolding (TODO markers in messages.ts), PostHog AC-19 event coverage + audit script, BILINGUAL_PROMPTS_V1 flag (default false), EN rubric protocol doc, type-generation refresh script, README + .env.example update                                                                                                    | In progress |

> PRs went through dual-LLM review (Claude + Codex critic loop) before merge. v4 plan iteration resolved 1 CRITICAL (Supabase Realtime replaces broken pg LISTEN) + 6 HIGH Codex findings.

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Covalent-Collective/world-shaker.git
cd world-shaker
npm install

# 2. Copy env and fill values
cp .env.example .env.local
# Fill in NEXT_PUBLIC_WORLD_APP_ID, SUPABASE_*, OPENROUTER_API_KEY, INNGEST_*, POSTHOG_*

# 3. Apply migrations (in order — see Migration Order below)
supabase db push

# 4. Start dev server and Inngest dev runner (separate terminals)
npm run dev
npm run inngest:dev

# 5. Run smoke test (verifies full interview → conversation → report pipeline)
npm run smoke:conversation

# 6. Expose for World App MiniKit testing
ngrok http 3000   # paste URL into Dev Portal QR
```

---

## Environment Variables

| Variable                        | Purpose                                                                                                              | Required     | Default                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------- |
| `NEXT_PUBLIC_WORLD_APP_ID`      | World Developer Portal app ID (client-visible)                                                                       | Yes          | —                                 |
| `NEXT_PUBLIC_WORLD_ACTION`      | Nullifier scope — fixed at deployment                                                                                | Yes          | `create-profile`                  |
| `NEXT_PUBLIC_WORLD_ENVIRONMENT` | `staging` or `production`                                                                                            | Yes          | `staging`                         |
| `WORLD_RP_ID`                   | Relying-party ID for IDKit RP context signing                                                                        | Yes          | —                                 |
| `WORLD_SIGNING_KEY`             | Server-only key for signing rp_context. Never expose to client                                                       | Yes          | —                                 |
| `WORLD_DEV_PORTAL_API_KEY`      | Server-side calls to World Dev Portal verify endpoint                                                                | Yes          | —                                 |
| `WORLD_APP_PUSH_ENABLED`        | Enables World App push (daily-digest + mutual-push). Set `false` until push SDK confirmed stable                     | No           | `false`                           |
| `WORLD_APP_PUSH_URL`            | Production push endpoint. Only read when `WORLD_APP_PUSH_ENABLED=true`                                               | Staging-only | —                                 |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (public)                                                                                        | Yes          | —                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public)                                                                                           | Yes          | —                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Service-role key — server-only; bypasses RLS                                                                         | Yes          | —                                 |
| `SUPABASE_JWT_SECRET`           | Must match Supabase project JWT secret so issued JWTs pass `auth.jwt()` in RLS                                       | Yes          | —                                 |
| `SUPABASE_PROJECT_ID`           | Required for `npm run db:gen-types` (supabase CLI type generation)                                                   | Yes          | —                                 |
| `SUPABASE_DB_PASSWORD`          | Supabase direct DB password (CLI migrations)                                                                         | Yes          | —                                 |
| `OPENROUTER_API_KEY`            | Required for all LLM calls (chat + embeddings via OpenRouter gateway)                                                | Yes          | —                                 |
| `OPENROUTER_CHAT_MODEL`         | Override chat model                                                                                                  | No           | `anthropic/claude-sonnet-4.6`     |
| `OPENROUTER_EMBEDDING_MODEL`    | Override embedding model                                                                                             | No           | `openai/text-embedding-3-small`   |
| `OPENROUTER_IMAGE_MODEL`        | Image model for avatar generation. If unset, deterministic placeholder avatars are used (keyed on feature hash)      | No           | placeholder fallback              |
| `INNGEST_EVENT_KEY`             | Inngest event ingestion key                                                                                          | Yes          | —                                 |
| `INNGEST_SIGNING_KEY`           | Inngest webhook signing key                                                                                          | Yes          | —                                 |
| `NEXT_PUBLIC_POSTHOG_KEY`       | PostHog project API key (client analytics)                                                                           | Yes          | —                                 |
| `NEXT_PUBLIC_POSTHOG_HOST`      | PostHog ingest host                                                                                                  | Yes          | `https://us.i.posthog.com`        |
| `POSTHOG_PROJECT_API_KEY`       | Server-side PostHog capture key (defaults to public key if unset)                                                    | No           | —                                 |
| `SLACK_WEBHOOK_URL`             | Destination for cost-cap alert notifications. If unset, alerts are logged server-side only                           | No           | —                                 |
| `BILINGUAL_PROMPTS_V1`          | Enables EN prompt rendering. Default `false` (KR-only) — flip to `true` only after EN rubric passes (Phase 5.5 gate) | No           | `false`                           |
| `NEXT_PUBLIC_APP_URL`           | Canonical hosted URL used in deep links                                                                              | Yes          | `https://world-shaker.vercel.app` |
| `SLACK_WEBHOOK_TS_ALERTS`       | T&S alert Slack webhook (separate channel from cost-cap alerts)                                                      | No           | —                                 |

---

## Migration Order

Apply in this exact order. Do **not** skip or reorder — later migrations reference columns and functions created by earlier ones.

```
0001_initial.sql          — 6 core tables + pgvector HNSW index
0002_rls.sql              — RLS policies (Codex audit baked in)
0003_ux_v1.sql            — UX v1 schema additions (avatar, language_pref, matches.origin, conversations state machine)
0003b_conversation_turns.sql — Normalized turns table + Supabase Realtime publication
0004_rls_ux_v1.sql        — RLS additions for UX v1 columns
0005_app_settings.sql     — app_settings singleton, llm_budget_ledger, rate_limit_buckets
0006_compatibility_score.sql — match_candidates() SQL function (pgvector + structured-feature scoring)
0007_seed_agents.sql      — Seed agent pool for alpha-stage first-encounter fallback
0008_user_badges.sql      — user_badges table (Verified Human badge persistence)
0009_match_candidates_v2.sql — match_candidates() v2 (calibrated weights, mode-aware exclusion)
0010_match_candidates_include_seeds.sql — Seed-include fix for Daily Stroll proactive mode
```

`0003_rollback.sql` is a manual recovery companion for migrations 0003–0006. Do not auto-run it — take a DB snapshot first.

> **Seed pool migration**: `0007_seed_agents.sql` must be applied to staging before launch gates below can be evaluated. Seed agents are required for the smoke test and first-encounter recovery path.

---

## Launch Gates

All gates must be green before a production release.

### R15 Timeline Decision (10-15 weeks vs. scope cuts)

The v4 plan honest re-baseline is 60-90 person-days (solo) / 30-45 elapsed days (2 specialists). Stakeholders must decide by R15:

- **Full S-grade (recommended)**: 10-15 weeks, 2 specialists. Ships Track A end-to-end + Track B Daily Stroll card stack at full polish.
- **Scope cut**: defer Living Agent editor, reduce interview probe depth, ship without avatar generation (placeholder only), defer EN bilingual to v1.1. Saves ~2-3 weeks.

### Phase 2 Rubric Pass

Two independent human reviewers (PM + one external rater; LLM may pre-screen but does not count) score 10 transcripts blind (persona names hidden). 10 dimensions: chemistry, distinct voices, conversational flow, callbacks, vulnerability, humor, language fidelity, pacing, ending strength, transcript readability. Scale 1-10.

- Pass: aggregate ≥ 7/10, no single dimension < 5
- Fallback [5, 7): ship with `BILINGUAL_PROMPTS_V1=false` permanently for v0
- Fail < 5: halt Phase 3, re-run Phase 2 prompt iteration (3-5 day buffer reserved in timeline)

200-pair eval set at `.omc/plans/match-eval-set.jsonl` (human-labeled, frozen reference). Calibration run: `npm run calibrate:match-weights`. Launch gate: Spearman ρ ≥ 0.4 on 40-pair held-out set.

### EN Rubric (Phase 5.5)

Run `npm run eval:en-prompts` against 10 EN-localized agent feature pairs. Same 10 dimensions as KR rubric, same 2-human blind scoring, same pass gate (aggregate ≥ 7/10, no dim < 5).

- Pass: flip `BILINGUAL_PROMPTS_V1=true` in staging, verify, then production.
- Fail: keep `BILINGUAL_PROMPTS_V1=false` at launch. Book EN re-eval for v1.1.

### Seed Pool Migration Applied to Staging

`0007_seed_agents.sql` applied to staging Supabase project. Smoke test passes: `npm run smoke:conversation`.

---

## Scripts

| Script                   | Command                               | Description                                                                                                         |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Smoke test               | `npm run smoke:conversation`          | End-to-end: two seeded agents → live conversation → report. Required before any deploy.                             |
| HNSW recall validation   | `npm run validate:hnsw`               | Inserts 1000 synthetic embeddings, asserts pgvector HNSW recall ≥ 0.95 vs. brute-force.                             |
| Match-weight calibration | `npm run calibrate:match-weights`     | Grid-searches (w_cosine, w_struct) against 200-pair human eval set. Outputs Spearman ρ + bootstrap CIs.             |
| Safety eval              | `npm run eval:safety`                 | Runs NSFW/hostile/repeat-loop pipeline against 300-turn labeled corpus. Gate: recall ≥ 0.95, FP ≤ 5%.               |
| EN prompt eval           | `npm run eval:en-prompts`             | Runs persona + agent-dialogue + report prompts against 10 EN feature pairs. Pre-gate for BILINGUAL_PROMPTS_V1 flip. |
| Outcome events audit     | `npm run audit:outcome-events`        | Checks all AC-12/AC-19 outcome_events emit paths. Generates `.omc/plans/outcome-events-coverage.md`.                |
| PostHog events audit     | `tsx scripts/audit-posthog-events.ts` | Checks all AC-19 PostHog capture call sites. Generates `.omc/plans/posthog-events-coverage.md`.                     |
| Fault injection          | `npm run inject:fault`                | Simulates LLM timeout, NSFW trip, and cost-cap breach mid-conversation. Verifies failure overlays and DB state.     |
| Type generation          | `npm run db:gen-types`                | Regenerates `types/db.gen.ts` from live Supabase schema. Requires `SUPABASE_PROJECT_ID` in env.                     |
| Timing audit             | `tsx scripts/audit-timing.ts`         | Verifies avatar generation ≤ 60s, first-encounter spawn ≤ 60s, report render < 500ms from cached starters.          |

---

## Project Structure

```
app/
├── (onboarding)/
│   ├── verify/         # World ID orb verify (IDKit widget)
│   ├── intro/          # 30s narrative video
│   └── interview/      # Hybrid interview (skeleton + LLM probes)
├── (app)/
│   ├── page.tsx        # Home / first-encounter recovery placeholder
│   ├── stroll/         # Daily Stroll card stack (Track B)
│   ├── conversation/[id]/  # Live conversation viewer (SSE)
│   └── match/[id]/     # Match report viewer + success screen
└── api/
    ├── rp-context/     # Signs IDKit RP context (server-only signing key)
    ├── verify/         # Validates IDKit proof, creates user
    ├── wallet-auth/    # Links wallet + world_username to user
    ├── agent/answer/   # Interview answer persistence + probe generation (rate-limited)
    ├── conversation/[id]/stream/  # SSE relay (Supabase Realtime backed)
    ├── conversation/[id]/abandon/ # Abandon in-flight conversation
    ├── match/[id]/like/           # Like / skip server action
    └── inngest/        # Inngest webhook

lib/
├── world/              # World ID constants, verify helpers
├── auth/               # JWT signing (jose), rate-limit middleware
├── supabase/           # client / server / service-role clients
├── llm/
│   ├── openrouter.ts   # OpenRouter gateway (chat + streaming + embeddings)
│   ├── safety.ts       # Safety pipeline (repeat-loop / NSFW / hostile + circuit-breaker)
│   ├── budget.ts       # Cost-cap preflight + per-user daily cap enforcement
│   └── prompts/        # persona, agent-dialogue, report, first-message, interview-probe
├── inngest/
│   └── functions/      # live-conversation, first-encounter, generate-report, nightly-match, cohort-rotate
├── avatar/             # Avatar generation (one-shot; placeholder fallback)
├── quota/              # Daily encounter quota helper
├── posthog/            # PostHog capture + cohort hashing (sha256 of world_user_id + quarterly salt)
├── i18n/               # KR/EN message catalogs, useT hook, getT server helper
└── flags.ts            # Feature flags (BILINGUAL_PROMPTS_V1, STROLL_WORLD_V1)

supabase/
└── migrations/         # See Migration Order above

scripts/                # CLI tools (smoke, validate, calibrate, eval, audit, inject)
types/
└── db.ts               # Hand-written DB types (mirror migrations)
```

---

## Key Design Decisions

| Decision                                                             | Why                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `nullifier` stored as `TEXT` not `NUMERIC(78,0)`                     | Codex flagged BigInt serialization risk                                                                                                     |
| `WORLD_ACTION = 'create-profile'` fixed at deployment                | Changing it invalidates all existing nullifiers                                                                                             |
| Orb-only verification                                                | One-human-one-agent guarantee                                                                                                               |
| `conversations` has no SELECT RLS policy                             | Hard service-role barrier per Codex audit — transcripts never reach client directly                                                         |
| SSE relay uses Supabase Realtime (not pg LISTEN)                     | pg LISTEN has 63-byte channel limit + per-connection pg cost; Realtime uses logical replication over WebSocket — works on Vercel serverless |
| `llm_budget_ledger` is enforcement source-of-truth                   | PostHog ingest lag makes it unsuitable for real-time cost-cap; Postgres ledger is transactional                                             |
| Atomic turn+ledger write (BEGIN; INSERT turn; INSERT ledger; COMMIT) | Prevents lost-charge or double-charge on Inngest retry                                                                                      |
| LLM in matching pipeline = explanation only                          | Compatibility scoring is deterministic SQL; same-model dual-role produces flattery (Codex)                                                  |
| `BILINGUAL_PROMPTS_V1=false` default                                 | Phase 2 rubric runs KR-only; EN rendering gated until EN rubric passes                                                                      |
| PostHog `distinct_id = sha256(world_user_id \| salt)`                | Raw world_user_id never leaves server; quarterly salt rotation with predecessor chain preserves funnel continuity                           |
| `outcome_events` schema fixed Day 0                                  | Moat data — start collecting immediately                                                                                                    |

---

## CI

GitHub Actions on every PR: `typecheck`, `lint`, `format:check`, `vitest --passWithNoTests`.
Vercel preview deploy auto-attached. Service-client whitelist test (`tests/ci/service-client-whitelist.test.ts`) fails the build if `getServiceClient()` is called from an unlisted path.

---

## Spec Sources

- Product spec: `.omc/specs/deep-interview-world-shaker-ux-v1.md` (ambiguity 4.5%, 19 rounds)
- Implementation plan: `.omc/plans/world-shaker-ux-v1-plan.md` (v4 — Codex re-reviewed)
- PRD: `.omc/prd.json`
- Decisions: 9-round Socratic deep interview (ambiguity 18.5%) + v4 Codex critic loop

---

## License

Private. Covalent-Collective.
