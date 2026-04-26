# Types Reconciliation Notes

## Why hand-written types/db.ts exists

`types/db.ts` predates Supabase project provisioning. It was authored manually to unblock
TypeScript development before a live project was available. Once the project is provisioned
and `types/db.gen.ts` can be generated reliably, `db.ts` will be replaced.

## When to regenerate

Run `npm run db:gen-types` (or `./scripts/regenerate-types.sh`) after any migration is applied
to the live Supabase project. The generated file is gitignored and must be regenerated locally
before running typechecks against live schema.

## Reconciliation process

After regenerating `types/db.gen.ts`:

1. Open both `types/db.ts` (hand-written) and `types/db.gen.ts` (generated) side by side.
2. For each table, decide:
   - **Keep hand-written**: if `db.ts` has stricter narrowed types, branded IDs, or domain
     constraints not expressible in the generated output.
   - **Use generated**: if the generated definition is accurate and the hand-written one has
     drifted (missing columns, wrong nullability, etc.).
3. Document any deliberate divergences as inline comments in `db.ts`.

## v1 follow-up

Once the Supabase project is provisioned and the regen output is trusted:

- Replace `types/db.ts` with re-exports from `types/db.gen.ts`.
- Update all import sites from `types/db` → `types/db.gen` (or a thin `types/index.ts` barrel).
- Remove the hand-written file and add a CI step to fail if `db.gen.ts` is stale.
