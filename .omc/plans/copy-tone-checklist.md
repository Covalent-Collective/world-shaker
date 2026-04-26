# Copy Tone Checklist — World Shaker

## Tone Target: Quiet Protector

World Shaker's voice is that of a calm, attentive companion — present without intruding, protective without being paternalistic. It does not celebrate or hype; it guides and holds space.

---

## Audit Principles

### 1. No Arcade Gamification Language

The following words and patterns are BANNED from all user-facing copy (KR and EN):

| Banned word / phrase | Why                                                     |
| -------------------- | ------------------------------------------------------- |
| unlock               | implies reward gate; feels like a game mechanic         |
| reward               | transactional; undermines genuine connection            |
| streak               | habit-tracker framing; creates anxiety around daily use |
| bonus                | promotional; cheapens the experience                    |
| win / winner         | competitive framing; connection is not a contest        |
| level up             | progression-game metaphor; wrong register entirely      |
| achievement          | badge-trophy framing                                    |
| points / score       | quantification of human relationship is harmful         |
| challenge            | implies difficulty as a feature, gamified               |
| limited time         | scarcity pressure; antagonistic to quiet protector      |

**Test enforcement:** `messages.test.tsx` runs a vitest case asserting none of these appear in any KR or EN message value.

---

### 2. KR Honorifics — Register Consistency

| Context                                                        | Recommended register                   | Reasoning                                                              |
| -------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| User-facing conversational copy (prompts, labels, status text) | **해요체** (e.g., ~해요, ~세요, ~어요) | Warm, approachable, maintains respectful distance without feeling cold |
| System messages (errors, technical status)                     | **합니다체** (e.g., ~합니다, ~습니다)  | Formal register appropriate for system notifications                   |
| Interview questions                                            | **해요체**                             | Soft invitation; 합니다체 feels like a survey form                     |
| Safety / reporting                                             | **합니다체**                           | Gravity of context warrants formality                                  |

**Violations to watch for:**

- Mixing 합니다체 and 해요체 within the same functional area
- Using plain form (~다, ~야) — too casual, no honorifics
- Ending labels (buttons) with trailing speech-level markers — button labels should be noun-form or infinitive, not full sentence endings

---

### 3. EN — Warm-but-Spare

Rules for English copy:

- **No exclamation marks** in informational or status copy. Reserved only for moments of genuine shared joy — and even then, use sparingly (0-1 per screen).
- **No "Awesome!", "Yay!", "Great!", "Amazing!"** — these read as Disney-grade enthusiasm that undercuts the quiet protector register.
- **No second-person possessives that over-claim** (e.g., "Your perfect match!" — avoids the word "perfect", avoids overselling).
- **Prefer plain past/present tense** over progressive where possible ("Conversation complete" not "Your conversation is now complete!").
- **Omit filler affirmations** — do not begin messages with "Great news:" or "We're happy to tell you".
- **Keep labels to 1-3 words** where possible. Clarity over warmth in microcopy.
- **Avoid technical jargon** in user-facing strings: no "overlay", "modal", "payload", "API", "streaming" (use "loading" or "preparing" instead).

---

### 4. Explanation-First Principle

When communicating a constraint or limit (quota exhausted, verification required, safety action), the pattern is:

1. **State what happened** — calmly, without blame
2. **Explain why** (if it fits in one short phrase)
3. **Offer the next step** — specific, actionable

Bad: "You can't do that right now."
Good: "You've met today's limit. Come back tomorrow." (quota case)

---

### 5. User-Facing vs. System-Facing Copy

| Category            | Standard                                                                   |
| ------------------- | -------------------------------------------------------------------------- |
| Button labels       | Noun or verb-noun, title-cased EN, no punctuation                          |
| Status text         | Sentence-cased, present or past tense, period optional                     |
| Error messages      | Sentence-cased, apologetic but not grovelling, always includes next step   |
| Interview questions | Sentence-cased, open-ended, no question marks that feel like interrogation |
| Placeholder text    | Lowercase, invitational, ellipsis `…` preferred over nothing               |

---

### 6. Checklist for Each Key Review

Before approving any copy, confirm:

- [ ] No arcade-gamification words present
- [ ] KR register consistent with context (해요체 vs 합니다체)
- [ ] EN has no exclamation marks unless justified
- [ ] EN has no Disney-grade affirmations
- [ ] No technical jargon in user-facing copy
- [ ] Explanation-first structure for constraint messages
- [ ] Label length appropriate (1-3 words for buttons)
- [ ] Both KR and EN convey the same emotional register
