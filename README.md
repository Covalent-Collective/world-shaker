# World Shaker

> World ID-gated AI dating MiniApp on World Network. Verified humans only.

**Status**: scaffold v0 — backend/data foundations laid; UX implementation pending product decisions.

## Stack

- **Frontend**: Next.js 15 (App Router) + `@worldcoin/minikit-js` + `@worldcoin/idkit` v4
- **Auth**: Wallet Auth (primary) + World ID **orb** (uniqueness gate)
- **Database**: Supabase Postgres + RLS + pgvector
- **Background jobs**: Inngest (nightly match generation)
- **LLM gateway**: OpenRouter (single API key) — chat = Claude Sonnet 4.6, embeddings = OpenAI text-embedding-3-small. Models are env-overridable.
- **Hosting**: Vercel

## Prerequisites

1. **World Developer Portal** app registered → `app_id`, `rp_id`, `signing_key`
2. **Supabase project** created → project URL, anon key, service role key
3. **OpenRouter API** key (covers Anthropic + OpenAI via single gateway)
4. **Inngest** workspace
5. Node 20+, npm, Supabase CLI

## Setup

```bash
# 1. clone and install
git clone https://github.com/Covalent-Collective/world-shaker.git
cd world-shaker
npm install

# 2. env
cp .env.example .env.local
# fill in values from Developer Portal, Supabase, OpenRouter, etc.

# 3. database
supabase db push  # applies supabase/migrations/*

# 4. dev
npm run dev          # next on :3000
npm run inngest:dev  # inngest dev server (separate terminal)

# 5. expose for World App testing
ngrok http 3000      # then enter URL in Dev Portal QR
```

## Project structure

```
app/
├── api/
│   ├── rp-context/     # signs IDKit RP context (server-only signing key)
│   ├── verify/         # validates IDKit proof, creates user
│   ├── wallet-auth/    # links wallet + world_username to user
│   └── inngest/        # Inngest webhook
├── layout.tsx
├── providers.tsx       # MiniKitProvider wrapper
└── page.tsx

lib/
├── world/              # World ID constants, verify helpers
├── auth/               # JWT signing for RLS (jose)
├── supabase/           # client / server / service-role clients
├── llm/                # OpenRouter client + prompts
└── inngest/            # job client + functions

supabase/
└── migrations/
    ├── 0001_initial.sql   # 6 core tables + indexes
    └── 0002_rls.sql       # RLS policies (Codex audit baked in)

types/
└── db.ts               # hand-written DB types (mirror migrations)
```

## Key design decisions (do not casually change)

| Decision                                              | Why                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `nullifier` stored as `TEXT` not `NUMERIC(78,0)`      | Codex flagged BigInt serialization risk                                             |
| `WORLD_ACTION = 'create-profile'`                     | Fixed at deployment. Changing invalidates all existing nullifiers.                  |
| Orb only (`verification_level` enum has only `'orb'`) | One-human-one-agent guarantee per v3 spec                                           |
| `surface` discriminator on agents/conversations       | v2 will add `'agora'` — schema anticipates without implementing                     |
| `conversations` has **no SELECT policy**              | Hard service-role barrier per Codex audit — transcripts never reach client          |
| `outcome_events` schema fixed Day 0                   | Volar moat data — start collecting immediately                                      |
| LLM in matching pipeline = explanation only           | Compatibility scoring is deterministic SQL (Codex: same-model dual-role = flattery) |

## What's NOT scaffolded yet (intentionally)

These wait for finalized UX:

- Onboarding screens / question copy
- Match card UI components
- Transcript display component
- Notification push integration (depends on World App SDK readiness)
- Reporting flow UI
- Settings screens
- WLD payment integration (v2)
- On-chain registry contract (v2)
- Agora ritual (v2)

## CI

GitHub Actions runs on every PR: typecheck, lint, format check, vitest.
Vercel preview deploy auto-attached.

## Spec sources

- Product spec: `.omc/specs/deep-interview-cupid-proxy-product-v3.md`
- Notion: World 해커톤 → 리서치 문서 + App Feature & Screen Spec
- Decisions: 9-round Socratic deep interview (ambiguity 18.5%)

## License

Private. Covalent-Collective.
