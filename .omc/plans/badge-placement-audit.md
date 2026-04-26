# VerifiedHumanBadge Placement Audit — AC-18

Audit date: 2026-04-26
Phase: 5 (US-502)

## Summary

AC-18 requires `<VerifiedHumanBadge>` to appear on:

- `/match/[id]`
- `/conversation/[id]`
- `/match/[id]/success`
- `/profile` (not yet built — v1 follow-up)

## Render Site Inventory

### Before Phase 5 changes

| File                                         | Line | Variant                           | Status                                  |
| -------------------------------------------- | ---- | --------------------------------- | --------------------------------------- |
| `app/(app)/match/[id]/MatchViewerClient.tsx` | 70   | `compact`                         | Present                                 |
| `app/(app)/conversation/[id]/page.tsx`       | 83   | `compact`                         | Present                                 |
| `app/(onboarding)/verify/page.tsx`           | 54   | `full` or `compact` (conditional) | Present (onboarding context, not AC-18) |

### After Phase 5 changes

| File                                         | Line | Variant   | Status               |
| -------------------------------------------- | ---- | --------- | -------------------- |
| `app/(app)/match/[id]/MatchViewerClient.tsx` | 70   | `compact` | Present (unchanged)  |
| `app/(app)/conversation/[id]/page.tsx`       | 83   | `compact` | Present (unchanged)  |
| `app/(app)/match/[id]/success/page.tsx`      | 47   | `compact` | **Added in Phase 5** |

### Changes Made

**`app/(app)/match/[id]/success/page.tsx`**

- Added import: `import VerifiedHumanBadge from '@/components/world/VerifiedHumanBadge';`
- Added render inside `<main>`: `<div className="absolute top-6 right-6"><VerifiedHumanBadge variant="compact" /></div>`
- Positioned top-right consistent with other pages.

## v1 Follow-ups

### `/profile` route — NOT YET BUILT

The `/profile` route does not exist anywhere in the codebase
(`app/(app)/profile/` directory absent). AC-18 lists it as a required badge
site. Once the profile route is built:

1. Import `VerifiedHumanBadge` in the profile page/client component.
2. Render `<VerifiedHumanBadge variant="compact" />` in the page header.
3. Add a placement test in `VerifiedHumanBadgePlacement.test.tsx` under the
   `/profile` describe block (currently a placeholder assertion).

## Test Coverage

Integration tests: `components/world/__tests__/VerifiedHumanBadgePlacement.test.tsx`

| Test suite                             | Coverage                                                  |
| -------------------------------------- | --------------------------------------------------------- |
| `match/[id] — MatchViewerClient`       | Renders badge with `aria-label`, renders ShieldCheck icon |
| `conversation/[id] — compact variant`  | Renders with `aria-label`, sr-only text for a11y          |
| `match/[id]/success — compact variant` | Renders with `aria-label`, renders ShieldCheck icon       |
| `/profile — not yet built`             | Placeholder assertion, tracks v1 follow-up                |

Unit snapshot tests: `components/world/__tests__/VerifiedHumanBadge.test.tsx`

- Full variant: text, aria-label, snapshot
- Compact variant: sr-only text, aria-label, snapshot
- className forwarding
