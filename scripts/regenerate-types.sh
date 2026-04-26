#!/bin/bash
# Regenerates types/db.gen.ts from the live Supabase project schema.
# Requires SUPABASE_PROJECT_ID env + supabase CLI installed.
set -e
if [ -z "$SUPABASE_PROJECT_ID" ]; then
  echo "SUPABASE_PROJECT_ID not set — cannot regenerate types."
  echo "This is a developer task pre-deploy. Set env and run: npm run db:gen-types"
  exit 0
fi
if ! command -v supabase &> /dev/null; then
  echo "supabase CLI not installed. Install via: brew install supabase/tap/supabase"
  exit 0
fi
npm run db:gen-types
echo "✅ Regenerated types/db.gen.ts from project $SUPABASE_PROJECT_ID"
