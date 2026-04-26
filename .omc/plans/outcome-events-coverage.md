# Outcome Events Coverage Report

> Generated: 2026-04-26T03:21:55.109Z
> Script: `scripts/audit-outcome-events.ts`

## Summary

- **Total event types**: 13
- **Covered** (≥1 emission): 7
- **Missing** (0 emissions): 6

## Coverage Table

| Event Type        | Emission Count | Files                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewed`          | 3              | `app/api/stroll/spawn/__tests__/route.test.ts:236`, `app/api/stroll/spawn/route.ts:212`, `scripts/audit-outcome-events.ts:78`                                                                                                                                                                                                                                                                                                     |
| `accepted`        | 2              | `app/api/match/[id]/like/__tests__/route.test.ts:188`, `app/api/match/[id]/like/__tests__/route.test.ts:246`                                                                                                                                                                                                                                                                                                                      |
| `skipped`         | 1              | `app/api/match/[id]/like/__tests__/route.test.ts:146`                                                                                                                                                                                                                                                                                                                                                                             |
| `mutual`          | 4              | `app/api/match/[id]/like/__tests__/route.test.ts:255`, `app/api/match/[id]/like/__tests__/route.test.ts:263`, `app/api/match/[id]/like/route.ts:114`, `app/api/match/[id]/like/route.ts:120`                                                                                                                                                                                                                                      |
| `chat_opened` ⚠   | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `replied_24h`     | 2              | `app/api/match/[id]/world-chat-replied/__tests__/route.test.ts:141`, `app/api/match/[id]/world-chat-replied/route.ts:59`                                                                                                                                                                                                                                                                                                          |
| `met_confirmed` ⚠ | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `safety_yes` ⚠    | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `safety_mixed` ⚠  | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `safety_no` ⚠     | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `wont_connect`    | 8              | `app/api/conversation/[id]/abandon/__tests__/route.test.ts:247`, `app/api/conversation/[id]/abandon/route.ts:94`, `app/api/conversation/[id]/restart/__tests__/route.test.ts:287`, `app/api/conversation/[id]/restart/route.ts:83`, `lib/inngest/functions/__tests__/first-encounter.test.ts:239`, `lib/inngest/functions/first-encounter.ts:49`, `lib/inngest/functions/live-conversation.ts:137`, `scripts/inject-fault.ts:244` |
| `vouched` ⚠       | 0              | —                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `report_filed`    | 2              | `app/api/report/__tests__/route.test.ts:200`, `app/api/report/route.ts:79`                                                                                                                                                                                                                                                                                                                                                        |

## Missing / TODO

- [ ] **`chat_opened`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'chat_opened'`.
- [ ] **`met_confirmed`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'met_confirmed'`.
- [ ] **`safety_yes`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'safety_yes'`.
- [ ] **`safety_mixed`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'safety_mixed'`.
- [ ] **`safety_no`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'safety_no'`.
- [ ] **`vouched`** — no emission found. TODO: add an INSERT into `outcome_events` with `event_type = 'vouched'`.

---

_This report is informational. It does not gate CI._
