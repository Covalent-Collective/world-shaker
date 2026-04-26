# PostHog Events Coverage Report (AC-19)

> Generated: 2026-04-26T04:39:18.938Z
> Script: `scripts/audit-posthog-events.ts`

## Summary

- **Total AC-19 event types**: 15
- **Covered** (≥1 emission): 9
- **Missing** (0 emissions): 6

## Coverage Table

| Event                                 | Emission Count | Files                                                                                              |
| ------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `interview_started` ⚠                 | 0              | —                                                                                                  |
| `interview_completed` ⚠               | 0              | —                                                                                                  |
| `first_encounter_spawned`             | 1              | `lib/inngest/functions/first-encounter.ts:169`                                                     |
| `conversation_streaming_started`      | 1              | `lib/inngest/functions/live-conversation.ts:202`                                                   |
| `conversation_completed`              | 1              | `lib/inngest/functions/live-conversation.ts:433`                                                   |
| `report_viewed` ⚠                     | 0              | —                                                                                                  |
| `report_expanded` ⚠                   | 0              | —                                                                                                  |
| `like_sent`                           | 1              | `app/api/match/[id]/like/route.ts:93`                                                              |
| `mutual_match`                        | 1              | `app/api/match/[id]/like/route.ts:141`                                                             |
| `world_chat_opened` ⚠                 | 0              | —                                                                                                  |
| `quota_blocked`                       | 1              | `app/api/stroll/spawn/route.ts:83`                                                                 |
| `conversation_failed_overlay_shown` ⚠ | 0              | —                                                                                                  |
| `llm_cost`                            | 1              | `lib/inngest/functions/live-conversation.ts:377`                                                   |
| `streaming_paused_cost_cap`           | 2              | `lib/inngest/functions/live-conversation.ts:146`, `lib/inngest/functions/live-conversation.ts:280` |
| `rate_limit_hit`                      | 1              | `app/api/stroll/spawn/route.ts:59`                                                                 |

## Missing / TODO

- [ ] **`interview_started`** — no emission found. TODO: add `captureServer('interview_started', ...)` or client-side `posthog.capture('interview_started')`.
  > Client-side event — emit at the start of the onboarding interview flow. Likely `app/(onboarding)/intro/page.tsx` or the first interview step component. v1 follow-up.
- [ ] **`interview_completed`** — no emission found. TODO: add `captureServer('interview_completed', ...)` or client-side `posthog.capture('interview_completed')`.
  > Client-side event — emit when the interview form is successfully submitted and agent created. Likely `app/(onboarding)/verify/page.tsx` after verify_success. v1 follow-up.
- [ ] **`report_viewed`** — no emission found. TODO: add `captureServer('report_viewed', ...)` or client-side `posthog.capture('report_viewed')`.
  > Client-side event — needs instrumentation in the report viewer component (e.g. `components/match/MatchCard.tsx` or the `/match/[id]` page `useEffect`). Use `identifyClient` + `posthog.capture` via `lib/posthog/client.ts`. v1 follow-up.
- [ ] **`report_expanded`** — no emission found. TODO: add `captureServer('report_expanded', ...)` or client-side `posthog.capture('report_expanded')`.
  > Client-side event — emit when the user taps "expand" on the conversation report drawer. Component instrumentation required. v1 follow-up.
- [ ] **`world_chat_opened`** — no emission found. TODO: add `captureServer('world_chat_opened', ...)` or client-side `posthog.capture('world_chat_opened')`.
  > Client-side event — emit when the user opens the World Chat link from the match card. Instrument in the World Chat CTA button component. v1 follow-up.
- [ ] **`conversation_failed_overlay_shown`** — no emission found. TODO: add `captureServer('conversation_failed_overlay_shown', ...)` or client-side `posthog.capture('conversation_failed_overlay_shown')`.
  > Client-side event — emit in the `ConversationFailedOverlay` component when it mounts. Requires component instrumentation. v1 follow-up.

## Hashing Policy

All server-side captures use `captureServer(eventName, { worldUserId })` from
`lib/posthog/server.ts`, which internally calls `hashCohort(worldUserId)` to
produce the SHA-256 cohort hash as `distinct_id`. Raw World user IDs never reach
PostHog (enforced by the `captureServer` wrapper).

Client-side captures must call `identifyClient(hashedDistinctId, predecessor)`
from `lib/posthog/client.ts` before emitting events, using the hashed id returned
by the server session — never the raw `world_user_id`.

## Phase Wiring Summary

| Phase             | Events Wired                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Phase 1           | PostHog client/server infrastructure, cohort hashing                                                  |
| Phase 4           | `llm_cost`, `streaming_paused_cost_cap`, `rate_limit_hit`, `first_encounter_spawned`, `quota_blocked` |
| Phase 5 (this PR) | Gaps documented above; client-side events deferred to v1                                              |

---

_This report is informational. It does not gate CI._
