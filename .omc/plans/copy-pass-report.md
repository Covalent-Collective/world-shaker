# Copy Pass Report — US-503

Generated: 2026-04-26  
Scope: All keys in `lib/i18n/messages.ts`  
Tone target: Quiet Protector (calm, explanation-first, no arcade gamification)  
Review status: DRAFT — no values changed; proposed alternatives are inline `// TODO(copy-review):` comments only

---

## Summary

| Category     | Keys reviewed | Flagged (violation or borderline) | Clean  |
| ------------ | ------------- | --------------------------------- | ------ |
| quota        | 1             | 1                                 | 0      |
| conversation | 4             | 2                                 | 2      |
| badge        | 1             | 1                                 | 0      |
| intro        | 2             | 1                                 | 1      |
| verify       | 4             | 0                                 | 4      |
| interview    | 8             | 0                                 | 8      |
| success      | 3             | 2                                 | 1      |
| match        | 6             | 0                                 | 6      |
| stroll       | 6             | 4                                 | 2      |
| safety       | 9             | 0                                 | 9      |
| common       | 5             | 0                                 | 5      |
| app_name     | 1             | 0                                 | 1      |
| **Total**    | **50**        | **11**                            | **39** |

No arcade-gamification words (`unlock`, `reward`, `streak`, `bonus`, `win`, `level up`) detected in current values.

---

## Detailed Key Review

| Key                                    | KR current                      | KR proposed               | EN current                       | EN proposed                         | Rationale                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------- | ------------------------- | -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quota.tomorrow`                       | 내일 다시 만나요                | 오늘은 여기까지예요       | Come back tomorrow               | That's all for today                | KR: '만나요' (let's meet) over-promises a reunion and directs the user to return; calmer alternative simply marks day's end in 해요체. EN: imperative 'Come back' is subtly pushy; 'That's all for today' is neutral and informational.                 |
| `conversation.failure_overlay.restart` | 다시 시작                       | 다시 시도하기             | Restart                          | Try again                           | 'Restart' / '다시 시작' implies full flow reset, which is alarming. '다시 시도하기' / 'Try again' signals a retry of the failed step only — lower stakes, more accurate.                                                                                |
| `conversation.failure_overlay.close`   | 닫기                            | 괜찮아요                  | Close                            | Dismiss                             | '닫기' / 'Close' is technically correct but cold for a failure overlay. '괜찮아요' adds warmth (it's okay / acknowledge). EN 'Dismiss' keeps the user in control without being clinical. Note: KR proposed is more radical and warrants human judgment. |
| `badge.verified_human`                 | 인증된 인간                     | 인증된 사람               | Verified Human                   | Verified person                     | '인간' (human) carries a sci-fi / robotic undertone; '사람' (person) is warmer, everyday language. EN same reasoning: 'person' > 'Human' in quiet-protector register.                                                                                   |
| `intro.title`                          | World Shaker 소개               | World Shaker를 시작하며   | Introducing World Shaker         | Getting started                     | '소개' / 'Introducing' reads like a product brochure header. Proposed alternatives shift to the user's perspective — their beginning, not the product's introduction.                                                                                   |
| `success.title`                        | 서로가 연결됐어요               | 서로가 닿았어요           | You matched each other           | You found each other                | '연결' (connected) is a technical-network metaphor; '닿다' (to touch / to reach) is more emotionally resonant. EN: 'matched' borrows dating-app / game result framing; 'found' is warmer and less transactional.                                        |
| `success.starter_label`                | 대화 시작하기                   | 대화 열기                 | Start the conversation           | Open conversation                   | '시작하기' / 'Start' is directional instruction; '열기' / 'Open' is shorter and frames the user as opening a door rather than executing a task.                                                                                                         |
| `stroll.title`                         | 오늘의 산책                     | 오늘의 만남               | Today's stroll                   | Today's encounters                  | '산책' (stroll/walk) is a deliberate product metaphor but may not land culturally. Borderline — keep if visual design reinforces the walk metaphor; swap to '만남' (encounters) if it doesn't. EN same logic.                                           |
| `stroll.tomorrow_at`                   | 내일 {time}에 다시 만나요       | 내일 {time}에 다시 이어요 | See you again tomorrow at {time} | Back tomorrow at {time}             | '다시 만나요' anthropomorphises the service; '다시 이어요' (pick back up) is quieter. EN: 'See you again' similarly over-promises a personal reunion; 'Back tomorrow' is factual.                                                                       |
| `stroll.streaming_paused`              | 오늘은 산책이 모두 마감되었어요 | 오늘은 모두 만났어요      | Today's stroll is fully closed   | You've met everyone available today | '마감' (deadline/closure) is borrowed from commerce/publishing; feels transactional. KR proposed uses positive framing. EN 'fully closed' uses shop-hours language. Proposed alternatives are explanation-first and positive.                           |
| `stroll.tap_to_start`                  | 탭해서 만나기                   | 탭하면 시작돼요           | Tap to start                     | Tap to begin                        | KR: '탭해서 만나기' is instructional (imperative + goal); '탭하면 시작돼요' explains the outcome of the tap. Borderline. EN: 'begin' vs 'start' is very minor — flag only for consistency audit.                                                        |

---

## Keys Reviewed and Confirmed Clean

The following keys were audited and require no proposed changes:

| Key                               | Notes                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `app_name`                        | Product name — unchangeable                                                      |
| `common.cancel`                   | Standard UI label                                                                |
| `common.continue`                 | Standard UI label                                                                |
| `common.confirm`                  | Standard UI label                                                                |
| `common.back`                     | Standard UI label                                                                |
| `conversation.preparing`          | Clear, calm, 합니다체 appropriate for system status                              |
| `conversation.complete`           | Noun-form completion label — clean                                               |
| `intro.skip`                      | Standard UI label                                                                |
| `verify.title`                    | Formal context warrants 합니다체; EN title-case fine                             |
| `verify.subtitle`                 | Explanation-first, accurate, no gamification                                     |
| `verify.cta`                      | Clear action label                                                               |
| `verify.error_toast`              | Apologetic + next step — correct pattern                                         |
| `interview.placeholder`           | Warm, invitational, ellipsis used correctly                                      |
| `interview.next`                  | Standard label                                                                   |
| `interview.complete`              | Standard label                                                                   |
| `interview.skeleton.q1`           | Open, 해요체, no jargon                                                          |
| `interview.skeleton.q2`           | Open, 해요체, no jargon                                                          |
| `interview.skeleton.q3`           | Notably strong — 'quietly working through' is excellent quiet-protector phrasing |
| `interview.skeleton.q4`           | Open, personal, appropriate                                                      |
| `interview.skeleton.q5`           | 'Made you grateful' — warm, no gamification                                      |
| `interview.skeleton.q6`           | 'Small thing' framing — appropriately low-stakes                                 |
| `success.world_chat_cta`          | Action label, no gamification                                                    |
| `match.why_click_label`           | Colloquial but fits the context                                                  |
| `match.watch_out_label`           | Informational, no alarm                                                          |
| `match.toggle_full`               | Standard label                                                                   |
| `match.toggle_highlights`         | Standard label                                                                   |
| `match.like`                      | Standard label                                                                   |
| `match.skip`                      | Standard label                                                                   |
| `stroll.quota_remaining`          | '{remaining} left today' — clean, explanation-first                              |
| `stroll.empty`                    | Calm, no blame                                                                   |
| `safety.report`                   | Standard label                                                                   |
| `safety.cancel`                   | Standard label                                                                   |
| `safety.report_reason.*` (6 keys) | Category labels — appropriate, no tone issues                                    |
| `safety.detail_placeholder`       | '(optional)' cue is correct                                                      |
| `safety.hide_and_report`          | Clear two-part action, appropriate gravity                                       |

---

## Honorifics Audit (KR)

| Area                   | Current register                        | Verdict                                                     |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `conversation.*`       | 합니다 / noun-form                      | Appropriate for system messages                             |
| `verify.*`             | 합니다체                                | Appropriate for formal verification context                 |
| `interview.skeleton.*` | 해요체 (나요? / 있다면요?)              | Correct — warm, open questions                              |
| `stroll.*`             | 해요체 (남았어요, 만나요, 마감되었어요) | Mostly correct; '마감되었어요' slightly formal — acceptable |
| `safety.*`             | Noun-form labels                        | Appropriate — no sentence endings needed                    |
| `success.*`            | 해요체 (연결됐어요)                     | Correct register                                            |
| `quota.tomorrow`       | 해요체 (만나요)                         | Correct register; content flagged above                     |

Register is broadly consistent. No mixing of 합니다체 and 해요체 within the same functional area detected.

---

## Next Steps for Human Review

1. Accept or reject each `// TODO(copy-review):` comment in `messages.ts`
2. If accepted, update the value and remove the comment in a follow-up PR
3. Pay particular attention to `conversation.failure_overlay.close` KR — '괜찮아요' is the most radical change and warrants product team sign-off
4. Confirm whether the '산책' (stroll) metaphor is visually reinforced; if not, swap to '만남'
5. Run `npm test -- messages` after any value changes to confirm the tone test still passes
