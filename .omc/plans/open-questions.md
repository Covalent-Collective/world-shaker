# Open Questions

## world-shaker-ux-v1 — 2026-04-26

- [ ] **Track B fidelity for v0** — Is "Daily Stroll cards" an acceptable approximation of the Sims-style world for v0, or does the product owner require visible "stroll" motion (parallax, ambient agents)? — Affects Phase 3 scope and timeline.
- [x] **Avatar regeneration policy** — RESOLVED 2026-04-26: one-shot at v0 per v4 plan recommendation. `avatar_generated_at` is immutable after first write; `generateAvatar()` short-circuits on re-call and returns existing URL without overwriting. Regeneration deferred to v1.1 if user complaints surface. Implemented in `lib/avatar/generate.ts` (US-501).
- [ ] **Cross-language matching opt-in** — Defer to v1 (recommended) or include as toggle in v0? — Affects matching SQL and language-stickiness eval.
- [ ] **Daily quota reset time** — UTC, user-local from MiniKit, or user-local from new `users.timezone` column? — Affects Step 1.5 quota helper and Step 4.4 enforcement copy.
- [ ] **First-message starter generation timing** — Pre-generate at `match.created` (recommended, +2-3s saved on success screen) or on-demand at mutual? — Affects Step 3.9 and prompt token budget.
- [ ] **Worldcoin push SDK capability date** — When will World App push API be confirmed available? — Affects Step 4.1/4.2 fallback strategy and daily digest design.
- [ ] **Onboarding video asset delivery date** — Product owner provides 30s narrative video; is asset ready or do we ship with placeholder? — Affects Step 3.1 ship gate.
- [ ] **OpenRouter image generation model choice** — Which provider/model for stylized avatars? Cost, latency, content-policy alignment? — Affects Step 3.4.
- [ ] **Seed agent pool persona authorship** — Internal team writes 12-20 seed personas, or commission writer? — Affects Step 4.6 and tone consistency.
- [ ] **NSFW/hostile-tone heuristics threshold** — How aggressive is moderation? Risk of false positives killing chemistry vs. trust loss from misses. — Affects Step 2.9 and ship-gate eval.
- [ ] **Bilingual tension at v0** — Spec mandates KR+EN at launch; plan honors but timeline pressure may resurface. Surface explicitly: do we have stakeholder buy-in on the ~3-5 day cost vs. KR-only fast lane?
- [ ] **Track A vs. Track B daily mix ratio** — Default proposal not specified in plan. Recommend 70% Track A blind / 30% Track B stroll once both surfaces live; verify with product before launch.

## v3 additions — 2026-04-26 (post dual-LLM critic review)

- [ ] **Timeline acceptance — 10-15 weeks vs. scope cut** (R15) — v3 honest re-baseline = 99-149 person-days. Stakeholder must explicitly choose: (a) full S-grade @ ~10-15 weeks, (b) cut Phase 4 ops + bilingual schema for ~6-8 weeks at known risk, (c) silent compression (Codex critic rejected). Decision blocks Phase 1 kickoff.
- [ ] **`pg LISTEN/NOTIFY` connection pool sizing** (R16) — SSE route now holds 1 persistent pg connection per active stream. What's expected peak concurrent live conversations? Pool sizing must accommodate; otherwise queue-and-fan-out single-LISTEN dispatcher refactor needed pre-launch.
- [ ] **Match-weight calibration eval set authorship** — 50 hand-curated agent pairs labeled by 2 humans (Step 1.13). Who authors? Same writers as seed agents (Step 4.6) or separate to avoid bias?
- [ ] **Per-user daily cost cap value** (AC-23b) — defaulted to $1.00 USD. Sanity-check after Phase 2 measures actual cost-per-encounter. May be too tight (blocks normal usage) or too loose (defeats purpose).
- [ ] **Phase 2 rubric 3rd reviewer** — tie-break protocol assumes a 3rd human is reachable on demand. Who? On what SLA? If nobody, fallback rule needed.
- [ ] **`conversation_turns` migration backfill timing** (R17) — drop JSONB `conversations.turns` column AFTER backfill verification. What's the verification gate? Row count match + spot-check 10 random conversations?
