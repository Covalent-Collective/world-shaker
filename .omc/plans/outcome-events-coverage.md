# Outcome Events Coverage Report

> Generated: 2026-04-26T03:00:22.711Z
> Script: `scripts/audit-outcome-events.ts`

## Summary

- **Total event types**: 13
- **Covered** (≥1 emission): 2
- **Missing** (0 emissions): 11

## Coverage Table

| Event Type        | Emission Count | Files                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewed`          | 2              | `app/api/stroll/spawn/__tests__/route.test.ts:236`, `app/api/stroll/spawn/route.ts:202`                                                                                                                                                                                                                                                                                                            |
| `accepted` ⚠      | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `skipped` ⚠       | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `mutual` ⚠        | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `chat_opened` ⚠   | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `replied_24h` ⚠   | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `met_confirmed` ⚠ | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `safety_yes` ⚠    | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `safety_mixed` ⚠  | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `safety_no` ⚠     | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `wont_connect`    | 7              | `app/api/conversation/[id]/abandon/__tests__/route.test.ts:247`, `app/api/conversation/[id]/abandon/route.ts:94`, `app/api/conversation/[id]/restart/__tests__/route.test.ts:288`, `app/api/conversation/[id]/restart/route.ts:84`, `lib/inngest/functions/__tests__/first-encounter.test.ts:230`, `lib/inngest/functions/first-encounter.ts:49`, `lib/inngest/functions/live-conversation.ts:137` |
| `vouched` ⚠       | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |
| `report_filed` ⚠  | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                  |

## Missing / TODO

- [ ] **`accepted`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'accepted'`.
- [ ] **`skipped`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'skipped'`.
- [ ] **`mutual`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'mutual'`.
- [ ] **`chat_opened`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'chat_opened'`.
- [ ] **`replied_24h`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'replied_24h'`.
- [ ] **`met_confirmed`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'met_confirmed'`.
- [ ] **`safety_yes`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'safety_yes'`.
- [ ] **`safety_mixed`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'safety_mixed'`.
- [ ] **`safety_no`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'safety_no'`.
- [ ] **`vouched`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'vouched'`.
- [ ] **`report_filed`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'report_filed'`.

---

_This report is informational. It does not gate CI._
