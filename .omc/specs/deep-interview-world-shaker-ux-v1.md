# Deep Interview Spec: World Shaker — UX Design v1

## Metadata

- Interview ID: wsh-ux-2026-04-26
- Rounds: 19
- Final Ambiguity Score: 4.5%
- Type: brownfield (UX layer on existing backend scaffold)
- Generated: 2026-04-26
- Threshold: 20%
- Status: PASSED (well below threshold)
- Predecessor spec: `.omc/specs/deep-interview-cupid-proxy-product-v3.md` (product-level, 18.5% ambiguity)

## Clarity Breakdown

| Dimension                    | Score | Weight | Weighted  |
| ---------------------------- | ----- | ------ | --------- |
| Goal Clarity                 | 0.97  | 0.35   | 0.340     |
| Constraint Clarity           | 0.96  | 0.25   | 0.240     |
| Success Criteria             | 0.95  | 0.25   | 0.238     |
| Context Clarity (brownfield) | 0.92  | 0.15   | 0.138     |
| **Total Clarity**            |       |        | **0.955** |
| **Ambiguity**                |       |        | **0.045** |

---

## Goal

World Shaker is a **World ID-gated AI dating MiniApp** where users build a stylized AI agent of themselves through a hybrid interview, then watch — Pokemon/Sims-style — as their agent encounters other users' agents in a strolling world. The signature moment is **reading the chemistry report of two agents' live conversation**, with reports curated as hybrid highlights → expandable transcript. Users send mutual likes after reading, leading to a quietly transitioned World Chat with first-message coaching.

**The S-grade core that everything else serves**: the chemistry of the two agents' auto-conversation. Visual, onboarding, and report wrapping are all in service of this central craft.

---

## Constraints

### Brand Voice & Tone

- **Calm protector** tone (not aggressive, not gamified arcade)
- **Computational soul** aesthetic — "your stylized self walking through a small world"
- Explanation-first when introducing safety/verification features

### Visual Identity

- Agent representation: **AI-stylized avatar** (user uploads photo → AI illustration)
- World metaphor: **Sims-aspirational** (isometric, idle animations, agent autonomy on display) for v1+, with v0 starting from a simpler approximation that preserves the "stroll" feel
- World ID "Verified Human" badge surfaced quietly (not as a banner) on profile/report screens

### Interview Structure

- **Hybrid: fixed skeleton + AI probing**
- 5-6 fixed core questions (progress bar guaranteed)
- 1-2 LLM probe follow-ups per answer
- 7-10 minute total runtime
- Each round persists answer immediately (resumable on drop-off)

### Matching Tracks (Dual)

- **Track A — Blind Discover**: Inngest nightly job generates encounters → user reads report → likes/skips → mutual like = match
- **Track B — Proactive Seek (Pokemon Encounter)**: User strolls a world surface; encounters NPC agents (random + seeded with people who liked them); eye-contact triggers auto agent-agent conversation
- Both tracks produce the same Conversation → Report → Match → World Chat funnel; only **MatchOrigin** discriminator differs (`system_generated` vs `user_initiated`)

### Encounter Mechanic

- Actor: **My agent ↔ Their agent**, autonomous
- Spectatorship: **Live rendering** — user can watch the conversation unfold real-time via streaming, or walk away and consume the report later
- World fidelity (v0 → v1 staging): start from "Daily Stroll cards" approximating the metaphor, evolve toward Sims-style isometric world. Worldcoin MiniApp webview constraints respected.

### Conversation Form

- Live streaming render via OpenRouter streaming + Inngest orchestration
- Both agents speak with distinct personas (LLM prompt engineering is the S-grade investment)
- Conversation continues in background if user leaves; final report ready on completion
- Length: enough turns to surface chemistry (target 12-25 turns; specific cadence to be tuned by LLM craft)

### Daily Quota & Monetization

- **MVP: free, with natural daily limit** (3-5 encounters/day per user)
- Beyond limit: "tomorrow's encounters incoming" pacing — gameified but non-coercive
- No premium tier in MVP — pure retention focus
- WLD payments deferred to v2 per existing roadmap

### Notification Cadence

- **Hybrid: Daily Digest + Impact-only push**
- One scheduled daily digest push (e.g., morning) — "오늘 N건의 새 만남, M건의 좋아요"
- Impact-only immediate push: mutual match success (the climax moment)
- All other events accumulate as in-app badge (no notification noise)
- Worldcoin MiniApp push capability: implementation contingent on World App SDK readiness; design assumes graceful fallback to in-app indicators

### Safety & Reporting

- **Quiet protection** tone
- Report entry point: roll-up menu of report/conversation/world-chat screens (not face-prominent)
- "Verified Human" World ID badge displayed discreetly to reinforce trust
- Reactive flow: 2 reports → auto-suspend (existing schema trigger)
- Outcome-event safety check-ins (`safety_yes`/`safety_mixed`/`safety_no`) surfaced via daily digest, not invasive prompts

### Match → World Chat Handoff

- Match-success screen surfaces 1-2 highlight quotes from the report as "first message starters"
- Single tap opens World Chat
- Brief farewell animation of the two agents passes meta context (which agents met, top topics)
- Coaching is suggestive, never auto-sent

### Language Policy

- **KR + EN bilingual** (auto-detect from World App locale; user can switch)
- Cross-language matching to be defined in implementation (default proposal: same-language pool with opt-in cross-language)
- All UI, agent personas, conversations, and reports rendered in user's selected language

### Onboarding First Impression

- After Orb verification: **30-second video narrative** explaining the loop ("자아 만들기 → 자동 소개팅 → 리포트와 만남")
- Video asset provided externally by product owner
- Skip available after 5s; completion tracked in PostHog
- Then: agent creation interview begins

### Day 1 First Encounter

- **Immediate**: Inngest job triggered on agent activation spawns first encounter right after interview completion
- User watches their first agent date as the immediate WOW moment
- Alpha-stage fallback: seed agent pool to ensure first encounter exists when active user count is low

### Agent Lifecycle (Living Agent)

- **No full re-roll** — agent identity persists (preserves match history, outcome events)
- Three growth paths:
  1. **Edit** existing answers (settings → answer-by-answer revision)
  2. **Additional questions** — agent proactively asks more (or user requests "ask me more")
  3. **Context dumps** — user pastes journal/tweet/self-description for richer persona
- All three trigger `extracted_features` re-derivation + embedding re-computation

### Failure Handling (Live Conversation)

- Server detects: LLM timeout, repeat-loop, NSFW moderation, hostile-tone heuristic
- UI overlays user-control buttons: **[대화 재시작] [대화 닫기]**
- No silent retry, no auto-mask — user has agency
- 재시작 resets turn count with same agents
- 닫기 marks conversation `abandoned`, closes UI

---

## Non-Goals (Explicitly Excluded from MVP)

- Native iOS/Android app (MiniApp webview only)
- WLD micropayments / paid features (v2)
- On-chain registry contract (v2)
- Agora ritual surface (v2 — schema discriminator already supports)
- Browse/search/filter directory of agents (proactive track happens via spatial encounter only)
- Reels-style infinite scroll
- Group chats / multi-agent encounters
- Custom agent visual editing beyond stylized avatar generation
- Real-time multiplayer presence (others seeing your character live in the world)
- Sims-level fidelity at MVP (v0 starts simpler; Sims is target visual aspiration)
- Premium tier / subscriptions

---

## Acceptance Criteria

- [ ] **Onboarding**: User completes Orb verify → 30s video → hybrid interview (5-6 skeleton + AI probes) in ≤10 min total
- [ ] **First Encounter**: Within 60 seconds of interview completion, the user can watch a live agent-to-agent conversation
- [ ] **Live Streaming**: Conversation streams turn-by-turn; user can leave and return to find a completed report
- [ ] **Report Viewing**: Default view shows curated highlights consumable in ≤30s; "전문 보기" toggle reveals full transcript
- [ ] **Track A (Blind)**: Nightly Inngest job generates batch matches; user finds new reports in daily digest
- [ ] **Track B (Proactive)**: User can walk a world surface, encounter NPC agents (random mix + people who liked them), trigger encounters by tap
- [ ] **Like Mechanic**: User can tap "좋아요" on report → contributes to mutual matching; can tap "스킵" to dismiss
- [ ] **Mutual Match**: When both sides like, match-success screen renders with 2 first-message starters and one-tap World Chat handoff
- [ ] **Agent Visual**: User uploaded photo → AI-stylized avatar generated within 60s of interview completion
- [ ] **Daily Quota**: User cannot exceed 3-5 encounters/day; UI communicates "내일 다시" with pleasant tone
- [ ] **Notifications**: One daily digest push at user-local morning; immediate push only on mutual match
- [ ] **Safety**: Report button accessible from menu on all match/conversation/chat screens; 2-report auto-suspend (existing trigger)
- [ ] **Language**: User can choose KR or EN at onboarding; setting persists; switchable later
- [ ] **Living Agent**: User can edit existing answers, request more questions, or paste context dumps; embedding re-computed on each change
- [ ] **Conversation Failure**: When LLM/moderation/timeout fails, [대화 재시작] [대화 닫기] overlay appears within 5s; no infinite spinners
- [ ] **Empty State**: Day 1 user with no encounter yet sees the immediate-spawn first encounter, not an empty state
- [ ] **Verified Human Badge**: World ID Orb badge appears on every profile/report/match screen, discreet but always present

---

## Assumptions Exposed & Resolved

| Assumption                                                              | Challenge (Mode)    | Resolution                                                                                  |
| ----------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| "Like flow is symmetric blind voting (Tinder-style)"                    | Contrarian (R5)     | Resolved as **dual-track**: blind nightly + proactive Pokemon-encounter                     |
| "Discovery should be the simplest browsable list"                       | Simplifier (R6)     | Rejected for spatial Pokemon-style world (more ambitious; user-vision-driven)               |
| "Encounter = user chats with the other agent directly"                  | Direct (R7)         | Resolved: my agent ↔ their agent, user spectates                                            |
| "Sims-level world is the MVP"                                           | Pragmatic (R8)      | Sims is aspiration; v0 ships simpler "stroll cards" approximation                           |
| "All four entities (agent/world/conversation/report) need equal polish" | Ontologist (R9)     | **Conversation chemistry is S-grade**; others B-grade-OK                                    |
| "Report is the signature moment"                                        | Reaffirmed (R1, R9) | Yes, but in service of Conversation. Report is the showcase, Conversation is the substance. |
| "Agent should be re-rollable"                                           | Refined (R17)       | Living agent (edit/extend/dump) — re-roll forbidden, identity persists                      |
| "Failure should be auto-recovered silently"                             | Refined (R19)       | Explicit user controls: 재시작 / 닫기                                                       |
| "Korean-only MVP"                                                       | Reframed (R15)      | KR+EN bilingual from launch (World App is global)                                           |

---

## Technical Context (Brownfield)

### Existing Schema (already migrated)

- `users` (World ID nullifier-keyed, wallet-linked)
- `agents` (interview_answers JSONB, extracted_features JSONB, embedding vector(1536), status enum)
- `conversations` (turns JSONB, surface enum, pair_key uniqueness)
- `matches` (compatibility_score, why_click, watch_out, highlight_quotes, rendered_transcript, world_chat_link, status enum, 48h expiry)
- `outcome_events` (12 event types — moat data layer, fixed Day 0)
- `reports` (7 report reasons, 2-strike auto-suspend trigger)

### Schema Adjustments Implied by This Spec

- `matches` may need `origin` discriminator (`system_generated` | `user_initiated_proactive` | `encounter_spawned`) — partial UNIQUE already supports
- `agents` may need `avatar_url` and `avatar_generated_at` columns (or treat as derived in features JSONB)
- `agents` may need `language` column (or features.language) — for matching pool filtering
- `conversations` may need `status` (`live` | `completed` | `abandoned` | `failed`) for live-rendering state machine
- New table or pattern needed for daily-quota tracking (or compute from `outcome_events` `viewed` count by day)
- New ambient world state table optional for Track B encounter generation if persistence beyond live session is required

### Tech Investments (per S-grade priority)

- **Top priority**: `lib/llm/prompts/` — agent persona system prompt + agent-to-agent dialogue prompt + report-extraction prompt. This is where chemistry quality lives.
- OpenRouter streaming wired into Inngest job (long-running conversation as background work with progress events to client)
- AI image generation pipeline (likely additional model via OpenRouter or external API) — moderate priority since avatar is B-grade
- Video player component for 30s onboarding intro
- Embedding re-computation trigger on agent answer updates

### Stack Already in Place (confirmed brownfield)

- Next.js 16 App Router, React 19
- @worldcoin/minikit-js, @worldcoin/idkit v4
- Supabase Postgres + RLS + pgvector (HNSW partial index for active+dating agents)
- Inngest for background jobs
- OpenRouter (Claude Sonnet 4.6 chat, OpenAI text-embedding-3-small)
- TanStack Query, react-hook-form + Zod, next-safe-action
- shadcn/ui + Radix + Tailwind
- PostHog (product analytics + session replay + LLM analytics)
- Vercel hosting

---

## Ontology (Key Entities)

| Entity                         | Type                   | Fields                                                                                                                | Relationships                                                 |
| ------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Agent                          | core domain            | interview_answers, extracted_features, embedding, status, surface, avatar_url, language                               | belongs to User; 1:1 with User; participates in Conversations |
| Report (Match Card)            | core domain            | compatibility_score, why_click, watch_out, highlight_quotes, rendered_transcript, status, world_chat_link, expires_at | derives from Conversation; pairs two Users                    |
| Conversation                   | **core (S-grade)**     | turns, surface, pair_key, status (live/completed/abandoned/failed)                                                    | between two Agents; produces Report                           |
| User                           | supporting             | nullifier, wallet_address, world_username, verification_level, language_pref                                          | owns one Agent; sends/receives Likes                          |
| Match                          | supporting             | user_id, candidate_user_id, conversation_id, status (pending/accepted/skipped/mutual/expired), origin                 | links Users via Report                                        |
| WorldChat                      | external system        | world_chat_link                                                                                                       | activated on mutual Match                                     |
| InterviewQuestion              | supporting             | type (skeleton/probe), order, answer, probe_depth                                                                     | composes Agent.interview_answers                              |
| MatchOrigin                    | discriminator          | system_generated, user_initiated_proactive, encounter_spawned                                                         | enum on Match                                                 |
| EncounterSurface (StrollWorld) | core feature surface   | layout, npc_pool, encounter_trigger                                                                                   | hosts Track B Encounters                                      |
| IncomingLike                   | signal                 | from_user, to_user, seen_at                                                                                           | seeds NPC pool in EncounterSurface                            |
| WorldStyling                   | aesthetic spec         | isometric, idle_animations, ambient_world, agent_avatars_walking                                                      | applies to EncounterSurface                                   |
| LiveStream                     | runtime state          | turn_index, streaming, viewer_present, final_report_ready                                                             | wraps Conversation during live render                         |
| DailyQuota                     | constraint             | daily_encounters_max, reset_time, next_encounter_eta                                                                  | per-User cap                                                  |
| AgentGrowth                    | living-agent mechanism | edit_log, additional_questions_asked, context_dumps, re_embedded_at                                                   | mutates Agent.interview_answers                               |

---

## Ontology Convergence

| Round | Entities | New                                | Changed    | Stable | Stability |
| ----- | -------- | ---------------------------------- | ---------- | ------ | --------- |
| 1     | 6        | 6                                  | -          | -      | N/A       |
| 2     | 6        | 0                                  | 1 (Report) | 5      | 100%      |
| 3     | 6        | 0                                  | 1 (Agent)  | 5      | 100%      |
| 4     | 7        | 1 (InterviewQuestion)              | 0          | 6      | 86%       |
| 5     | 8        | 1 (MatchOrigin)                    | 0          | 7      | 88%       |
| 6     | 10       | 2 (EncounterSurface, IncomingLike) | 0          | 8      | 80%       |
| 7     | 10       | 0                                  | 0          | 10     | 100%      |
| 8     | 11       | 1 (WorldStyling)                   | 0          | 10     | 91%       |
| 9     | 11       | 0                                  | 0          | 11     | 100%      |
| 10    | 12       | 1 (LiveStream)                     | 0          | 11     | 92%       |
| 11    | 12       | 0                                  | 0          | 12     | 100%      |
| 12    | 13       | 1 (DailyQuota)                     | 0          | 12     | 92%       |
| 13    | 13       | 0                                  | 0          | 13     | 100%      |
| 14    | 13       | 0                                  | 0          | 13     | 100%      |
| 15    | 13       | 0                                  | 0          | 13     | 100%      |
| 16    | 13       | 0                                  | 0          | 13     | 100%      |
| 17    | 14       | 1 (AgentGrowth)                    | 0          | 13     | 93%       |
| 18    | 14       | 0                                  | 0          | 14     | 100%      |
| 19    | 14       | 0                                  | 0          | 14     | 100%      |

Final ontology: 14 entities, fully converged.

---

## Open Refinements (designer/implementer judgment)

These are intentionally not specified — they are sub-S-grade details where designer/implementer agency adds value.

- Exact CTA copy and microcopy tone
- Specific card layout (info hierarchy on report)
- Color palette, typography, motion language
- Onboarding video script and storyboarding (asset by product owner)
- Cross-language matching opt-in UI flow specifics
- Sims-aspirational world v0 → v1 staging plan (engine choice, asset scope)
- Specific cadence of LLM probes during interview
- Daily digest push copy template
- Reset-time logic for daily quota (UTC vs user local)
- Agent avatar regeneration policy (one-shot vs allow re-render)
- First message starter generation prompt
- Empty state copy when active agent pool too small for Track B
- Track A and Track B mixing ratio in daily encounters

---

## Interview Transcript

<details>
<summary>Full Q&A (19 rounds)</summary>

### Round 1 — Signature Moment (Goal Clarity)

**Q**: 4단계 플로우에서 사용자가 가장 강렬한 감정을 느끼는 시그니처 모먼트는?
**A**: 리포트를 훔쳐보는 재미
**Ambiguity**: 100% → 61.5%

### Round 2 — Report Intent (Success Criteria)

**Q**: 리포트는 엔터테인먼트인가 결정 지원인가?
**A**: 하이브리드 — 하이라이트 먼저, 전문 토글 가능
**Ambiguity**: 61.5% → 49.8%

### Round 3 — Agent Visual (Constraints)

**Q**: 에이전트는 시각적으로 어떻게 표현?
**A**: AI 스타일라이즈드 아바타 (사진 입력 → 일러스트)
**Ambiguity**: 49.8% → 39.6%

### Round 4 — Interview Style (Constraints)

**Q**: 에이전트 생성 인터뷰의 구조는?
**A**: 하이브리드 — 고정 스켈레톤 + AI 프로빙
**Ambiguity**: 39.6% → 34.3%

### Round 5 [CONTRARIAN] — Like Mechanic (Success Criteria)

**Q**: 양측 비밀투표식 매칭이 정말 최선인가?
**A**: 비대칭 (먼저 좋아요)도 함께 — 둘 다 있어야
**Ambiguity**: 34.3% → 34.7% (재발견 후 정리)

### Round 6 [SIMPLIFIER] — Discovery Surface (Constraints)

**Q**: 프로액티브 트랙의 디스커버리 표면?
**A**: 포켓몬식 NPC 인카운터 (랜덤 + 좋아요 누른 사람 시드)
**Ambiguity**: 34.7% → 47.2% (비전 확장)

### Round 7 — Encounter Actor (Goal Clarity)

**Q**: 인카운터의 대화 주체는?
**A**: 내 에이전트 ↔ 상대 에이전트 (자동, 나중에 리포트)
**Ambiguity**: 47.2% → 31.5%

### Round 8 — World Fidelity (Constraints)

**Q**: '산책'은 어느 정도 문자 그대로?
**A**: Sims 감성
**Ambiguity**: 31.5% → 34.7%

### Round 9 [ONTOLOGIST] — Core Entity (Goal Clarity)

**Q**: 4개 엔티티 중 v0 S급은?
**A**: ③ 대화 자체 (두 에이전트의 케미스트리)
**Ambiguity**: 34.7% → 22.5%

### Round 10 — Conversation Form (Constraints)

**Q**: 두 에이전트의 대화는 어떤 형태?
**A**: 라이브 렌더링 (실시간 관람 가능)
**Ambiguity**: 22.5% → 16.3% **🎯 임계 통과**

### Round 11 — Notification (Constraints)

**Q**: 알림/리텐션 체제는?
**A**: 하이브리드 — 데일리 다이제스트 + 임팩트 푸시만
**Ambiguity**: 16.3% → 14.2%

### Round 12 — Monetization (Constraints)

**Q**: MVP 결제 철학은?
**A**: 무료 + 일일 자연적 한도 (게임화 해당)
**Ambiguity**: 14.2% → 11.9%

### Round 13 — Safety UX (Constraints/Success)

**Q**: 안전·신고 UX 톤?
**A**: 조용한 보호 — 메뉴 구석, 설명과 함께
**Ambiguity**: 11.9% → 9.9%

### Round 14 — Match → World Chat Handoff

**Q**: World Chat 핸드오프 핵심 경험?
**A**: 스르르 자연스러운 이축 + 첫 인사 코칭
**Ambiguity**: 9.9% → 7.6%

### Round 15 — Language Policy

**Q**: 언어 정책은?
**A**: KR + EN 이중 제공 — 사용자가 선택
**Ambiguity**: 7.6% → 8.4%

### Round 16 — Onboarding First Impression

**Q**: World ID 인증 직후 첫 화면?
**A**: 30초 영상 (사용자가 별도 제공) → 인터뷰 시작
**Ambiguity**: 8.4% → 6.7%

### Round 17 — Agent Re-rolling

**Q**: 에이전트 재롤링/수정 정책?
**A**: 수정 + 추가 질문 답변 + 컨텍스트 덤프 (live agent)
**Ambiguity**: 6.7% → 6.3%

### Round 18 — Day 1 First Encounter

**Q**: 새 사용자 첫 인카운터 타이밍?
**A**: 즉시 (온보딩 직후 자동 생성)
**Ambiguity**: 6.3% → 5.4%

### Round 19 — Failure Handling

**Q**: 라이브 대화 실패 시 처리?
**A**: 재시작/닫기 버튼 노출 — 사용자 통제
**Ambiguity**: 5.4% → **🎯 4.5%**

</details>
