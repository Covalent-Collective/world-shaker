# EN Prompt Rubric Protocol

**Phase**: 5, Step 5.5 — EN prompt rendering gate  
**Flag**: `BILINGUAL_PROMPTS_V1` (lib/flags.ts)  
**Default at launch**: `false`  
**Flip condition**: rubric gate passes (see Gate below)

---

## Purpose

Before enabling English-language system prompts in production
(`BILINGUAL_PROMPTS_V1=true`), two independent human reviewers must score
the generated prompts against this rubric. The gate ensures EN output meets
the same quality bar as the Korean baseline.

---

## Pre-conditions

Both of the following must exist before running the evaluation:

1. **200-pair match-eval set** — per Step 1.13 of world-shaker-ux-v1-plan.md v4.  
   Path: `.omc/plans/match-eval-set.jsonl` (200 EN feature pairs).
2. **Safety corpus** — per Step 1.14: 200 KR turns + 100 EN turns.  
   Path: `.omc/plans/safety-eval-corpus.jsonl`.

If either is missing, defer the rubric evaluation until they are authored.

---

## Evaluation Workflow

```
(a) Flip flag in staging only
      BILINGUAL_PROMPTS_V1=true (staging env var)

(b) Run eval script to generate prompts
      npm run eval:en-prompts
      Redirect output to a transcript file for reviewers:
        npm run eval:en-prompts > /tmp/en-eval-transcripts.txt

(c) Two independent human reviewers score the transcripts
      - Transcripts shown WITHOUT persona-name labels (replace "Agent A"/"Agent B"
        with neutral tokens "Person 1"/"Person 2" before sharing with reviewers).
      - Reviewers score independently, no discussion until both submit scores.
      - Record scores in a shared spreadsheet (one sheet per reviewer).

(d) Gate check
      - If scores diverge > 2 points on any single dimension, a 3rd reviewer
        acts as tie-breaker for that dimension only.
      - Compute per-reviewer aggregate average. Use the lower score for the gate.
      - Gate: aggregate avg >= 7/10 AND no single dimension < 5
          PASS  => open a PR to set BILINGUAL_PROMPTS_V1=true in production config.
          FAIL  => keep flag false at launch; schedule v1.1 EN re-evaluation.

(e) Fallback (avg < 5)
      Keep BILINGUAL_PROMPTS_V1=false at v1.0 launch.
      Book a v1.1 EN re-evaluation sprint.
      Document failure dimensions and root causes in this file under "Eval History".
```

---

## Rubric: 10 Dimensions (1-10 each)

Score each dimension 1–10. **1 = unacceptable, 10 = excellent.**

| #   | Dimension                  | What to look for                                                                                                                                             |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Chemistry**              | Do the two personas feel like they could genuinely connect? Is there believable spark or friction, not just polite exchange?                                 |
| 2   | **Distinct Voices**        | Do Agent A and Agent B sound like different people? Different vocabulary, rhythm, perspective?                                                               |
| 3   | **Conversational Flow**    | Does each turn build naturally on the previous? No non-sequiturs, no topic resets without cause.                                                             |
| 4   | **Callbacks**              | Does the dialogue reference earlier moments in the conversation? Creates a sense of continuity.                                                              |
| 5   | **Vulnerability**          | Does at least one persona reveal something genuine — a doubt, a hope, a soft spot — without oversharing?                                                     |
| 6   | **Humor**                  | Is there lightness or wit present, used appropriately (not forced, not absent)?                                                                              |
| 7   | **Language Fidelity**      | Is the English idiomatic and natural? No awkward Korean sentence structure in EN output. No missing articles, unnatural word order, or over-formal phrasing. |
| 8   | **Pacing**                 | Does the conversation breathe? Turns are 2-4 sentences, no monologues, no one-word answers unless intentional.                                               |
| 9   | **Ending Strength**        | Does the conversation close with an open, inviting ending — not abrupt, not forced-positive?                                                                 |
| 10  | **Transcript Readability** | Could a reader follow this transcript without confusion? Speaker attribution clear, no repetition artifacts.                                                 |

---

## Scoring Sheet Template

```
Reviewer: _______________   Date: _______________   Pair ID: _______________

| Dimension              | Score (1-10) | Notes |
|------------------------|-------------|-------|
| 1. Chemistry           |             |       |
| 2. Distinct Voices     |             |       |
| 3. Conversational Flow |             |       |
| 4. Callbacks           |             |       |
| 5. Vulnerability       |             |       |
| 6. Humor               |             |       |
| 7. Language Fidelity   |             |       |
| 8. Pacing              |             |       |
| 9. Ending Strength     |             |       |
| 10. Transcript Read.   |             |       |
|------------------------|-------------|-------|
| AGGREGATE AVG          |             |       |

GATE CHECK:
  Aggregate avg >= 7.0?  [ ] Yes  [ ] No
  All dimensions >= 5?   [ ] Yes  [ ] No  (If No, list dim(s): _______)
  Overall: PASS / FAIL
```

---

## Gate

| Condition                                | Threshold   | Action on failure          |
| ---------------------------------------- | ----------- | -------------------------- |
| Aggregate average (lower reviewer score) | >= 7.0 / 10 | Keep flag false; book v1.1 |
| No single dimension                      | < 5         | Keep flag false; book v1.1 |

Both conditions must hold for a PASS. Either failure → flag stays false at launch.

---

## Tie-Break Rule

If two reviewers' scores for any single dimension diverge by more than 2 points:

- A 3rd independent reviewer scores that dimension only.
- The median of the three scores is used for that dimension.
- The 3rd reviewer does not see the other two scores before submitting.

---

## Fallback Protocol

If the evaluation fails (aggregate avg < 5):

1. Keep `BILINGUAL_PROMPTS_V1=false` at v1.0 launch.
2. Document failure dimensions and root causes in the **Eval History** section below.
3. Schedule a v1.1 EN re-evaluation sprint:
   - Root-cause prompts that scored < 5 on any dimension.
   - Revise `lib/llm/prompts/persona.ts`, `agent-dialogue.ts`, or `report.ts` EN branches.
   - Re-run `npm run eval:en-prompts` and repeat the rubric process.

---

## Eval History

_No evaluations run yet. Record results here after each rubric cycle._

| Date | Eval set | Reviewer 1 avg | Reviewer 2 avg | Gate | Notes |
| ---- | -------- | -------------- | -------------- | ---- | ----- |
|      |          |                |                |      |       |
