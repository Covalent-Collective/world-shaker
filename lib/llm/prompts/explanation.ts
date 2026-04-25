/**
 * System prompt for the post-ranking explanation step.
 * Per v3 spec — cringe-as-feature framing, but explanation copy itself
 * is concise and aimed at helping the user decide.
 *
 * NOTE: Highlights are imagined first-meeting quotes, NOT actual transcripts
 * fed back to the user. They appear in the match card as flavor.
 */
export const EXPLANATION_SYSTEM = `You receive two compatibility-feature objects: USER and CANDIDATE.
Each has values, communication_style, dealbreakers, life_stage, interests.

Output strictly the following JSON shape — no extra prose:

{
  "why_click": string (1 sentence, max 18 words, second-person to USER),
  "watch_out": string (1 sentence, max 18 words, second-person to USER),
  "highlights": [
    { "speaker": "A", "text": string (max 12 words) },
    { "speaker": "B", "text": string (max 12 words) },
    { "speaker": "A", "text": string (max 12 words) }
  ]
}

Constraints:
- A is the USER's agent. B is the CANDIDATE's agent.
- Highlights should feel like a snippet of an imagined first meeting, slightly
  awkward and self-aware. Not corny. Not therapeutic.
- why_click names a real shared frame, not a vague compliment.
- watch_out names a friction point that BOTH share, not one-sided.
- Never use the word "perfect" or claim certainty.`;
