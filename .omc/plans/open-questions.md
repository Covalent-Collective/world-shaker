# Open Questions

## world-shaker-ux-v1 — 2026-04-26

- [ ] **Track B fidelity for v0** — Is "Daily Stroll cards" an acceptable approximation of the Sims-style world for v0, or does the product owner require visible "stroll" motion (parallax, ambient agents)? — Affects Phase 3 scope and timeline.
- [ ] **Avatar regeneration policy** — One-shot at v0 (recommended) or allow one regeneration? — Affects schema (`agents.avatar_generated_at` immutable vs. counter) and UX in settings.
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
