#!/usr/bin/env tsx
/**
 * scripts/validate-hnsw-recall.ts
 *
 * Validates that the partial HNSW index on public.agents achieves ≥ 0.95 recall@10
 * against a brute-force linear scan.
 *
 * REQUIREMENTS:
 *   - Live Supabase connection: set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   - Applied migrations: 0001_initial.sql (users + agents + HNSW index)
 *   - The script inserts synthetic users + agents, then cleans them up. It does NOT
 *     use a Postgres transaction (PostgREST doesn't expose BEGIN/COMMIT), so cleanup
 *     is performed in a try/finally block via explicit DELETE statements.
 *     If the process is killed mid-run, rows with nullifier LIKE 'test_nullifier_%'
 *     can be manually purged:
 *       DELETE FROM public.agents WHERE user_id IN
 *         (SELECT id FROM public.users WHERE nullifier LIKE 'test_nullifier_%');
 *       DELETE FROM public.users WHERE nullifier LIKE 'test_nullifier_%';
 *
 * HOW IT WORKS:
 *   1. Inserts 1000 synthetic users (with valid required fields) and matching agents
 *      with random 1536-dim normalized embeddings.
 *   2. Picks 50 random query vectors (normalized).
 *   3. For each query:
 *      a. Queries top-10 via the HNSW index using PostgREST vector ordering
 *         (?order=embedding.cd.<vector>) — if this path is unavailable, exits 2.
 *      b. Queries top-10 via brute-force (client-side cosine sort from fetched embeddings).
 *      c. Computes recall@10 = |HNSW_top10 ∩ brute_top10| / 10.
 *   4. Asserts avg_recall ≥ 0.95; exits 0 on pass, 1 on fail, 2 on setup/query error.
 *
 * PGVECTOR ORDERING VIA POSTGREST:
 *   PostgREST supports pgvector ordering via the query parameter syntax:
 *     ?order=embedding.cd.<vector_literal>
 *   where "cd" means "cosine distance" (<=>). This triggers the HNSW index when the
 *   WHERE clause matches the partial index predicate (status=active, surface=dating,
 *   embedding IS NOT NULL). If PostgREST rejects the vector ordering (non-200 response
 *   or empty result set), the script exits 2 with a clear error rather than silently
 *   substituting brute-force results (which would report recall=1.0 — a false pass).
 *
 *   Alternative if PostgREST vector ordering is not available:
 *     - Apply a migration adding an RPC: match_candidates_top_k_for_validation(
 *         query_embedding vector, k int, candidate_ids uuid[]
 *       ) that runs the ORDER BY embedding <=> $1 LIMIT $2 query server-side.
 *     - Or connect via a direct postgres:// connection using pg/postgres.js and
 *       issue SET enable_indexscan=off for the brute-force path.
 *
 * CI NOTE:
 *   This script requires a live Supabase instance and is NOT run in CI by default.
 *   Wire into CI with a seeded Supabase container or run manually before releases.
 *   The npm script `validate:hnsw` is the entry point.
 *
 * EXIT CODES:
 *   0  All checks passed (avg recall@10 >= 0.95).
 *   1  Recall check failed (avg recall@10 < 0.95).
 *   2  Setup/connection/query error (fix the env or schema and retry).
 *
 * USAGE:
 *   tsx scripts/validate-hnsw-recall.ts [--help]
 */

// ---------------------------------------------------------------------------
// Help flag — must be handled before any imports that require env vars.
// ---------------------------------------------------------------------------
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: tsx scripts/validate-hnsw-recall.ts [--help]

Validates HNSW index recall on the public.agents table.

Options:
  --help, -h   Show this help message and exit.

Environment variables (required for actual validation):
  NEXT_PUBLIC_SUPABASE_URL      Your Supabase project URL.
  SUPABASE_SERVICE_ROLE_KEY     Service role key (bypasses RLS).

Exit codes:
  0  All checks passed (avg recall@10 >= 0.95).
  1  Recall check failed (avg recall@10 < 0.95).
  2  Connection/setup/query error (skip in CI, fix the env and retry).

Example:
  NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co \\
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \\
  tsx scripts/validate-hnsw-recall.ts
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Imports — after help check so --help works without env vars.
// ---------------------------------------------------------------------------
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const EMBEDDING_DIM = 1536;
const N_AGENTS = 1000;
const N_QUERIES = 50;
const K = 10;
const RECALL_THRESHOLD = 0.95;
const BATCH_SIZE = 100; // insert rows in batches to stay under payload limits

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

/** Returns a random Float64Array of length `dim` drawn from N(0,1). */
function randomVector(dim: number): number[] {
  const v: number[] = [];
  for (let i = 0; i < dim; i++) {
    // Box-Muller for roughly normal distribution (cosine similarity is
    // direction-only so any distribution with non-zero norm works).
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    v.push(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
  }
  return normalizeVector(v);
}

/** L2-normalizes a vector in-place and returns it. */
function normalizeVector(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** Formats a number[] as a Postgres vector literal '[0.1,0.2,...]'. */
function toVectorLiteral(v: number[]): string {
  return '[' + v.join(',') + ']';
}

// ---------------------------------------------------------------------------
// Supabase client (raw, no server-only guard — this is a script context)
// ---------------------------------------------------------------------------
function makeClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
        'Run with --help for usage.',
    );
    process.exit(2);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------------
// Synthetic data types
// ---------------------------------------------------------------------------

interface SyntheticUser {
  nullifier: string;
  action: string;
  verification_level: 'orb';
  wallet_address: null;
  world_username: null;
}

interface SyntheticAgent {
  user_id: string;
  embedding: string; // vector literal
  status: 'active';
  surface: 'dating';
}

// ---------------------------------------------------------------------------
// Synthetic data generation
// ---------------------------------------------------------------------------

/**
 * Generates N_AGENTS synthetic user rows and matching agent rows.
 * Each user gets a unique nullifier (concat of 'test_nullifier_' + UUID) so
 * the UNIQUE(nullifier, action) constraint on public.users is satisfied.
 * Users are inserted first to satisfy the agents.user_id FK.
 */
function generateSyntheticData(): {
  userRows: SyntheticUser[];
  agentRowTemplates: Array<{ userNullifier: string; embedding: string }>;
  vectors: number[][];
  userNullifiers: string[];
} {
  const userRows: SyntheticUser[] = [];
  const agentRowTemplates: Array<{ userNullifier: string; embedding: string }> = [];
  const vectors: number[][] = [];
  const userNullifiers: string[] = [];

  for (let i = 0; i < N_AGENTS; i++) {
    const nullifier = `test_nullifier_${crypto.randomUUID()}`;
    const vec = randomVector(EMBEDDING_DIM);
    vectors.push(vec);
    userNullifiers.push(nullifier);
    userRows.push({
      nullifier,
      action: 'test_calibration',
      verification_level: 'orb',
      wallet_address: null,
      world_username: null,
    });
    agentRowTemplates.push({
      userNullifier: nullifier,
      embedding: toVectorLiteral(vec),
    });
  }

  return { userRows, agentRowTemplates, vectors, userNullifiers };
}

// ---------------------------------------------------------------------------
// Insertion helpers
// ---------------------------------------------------------------------------

/**
 * Inserts synthetic agent rows in batches.
 * Requires userIdByNullifier map to resolve user_id FK from nullifier.
 * Returns inserted agent IDs in insertion order.
 */
async function insertAgents(
  client: SupabaseClient,
  agentTemplates: Array<{ userNullifier: string; embedding: string }>,
  userIdByNullifier: Map<string, string>,
): Promise<string[]> {
  const ids: string[] = [];

  for (let start = 0; start < agentTemplates.length; start += BATCH_SIZE) {
    const batch = agentTemplates.slice(start, start + BATCH_SIZE).map((t) => {
      const userId = userIdByNullifier.get(t.userNullifier);
      if (!userId) {
        throw new Error(`No user_id found for nullifier: ${t.userNullifier}`);
      }
      const agent: SyntheticAgent = {
        user_id: userId,
        embedding: t.embedding,
        status: 'active',
        surface: 'dating',
      };
      return agent;
    });

    const { data, error } = await client.from('agents').insert(batch).select('id');

    if (error) {
      throw new Error(
        `Failed to insert agent batch [${start}..${start + batch.length}]: ${error.message}`,
      );
    }
    if (!data) throw new Error('Agent insert returned no data');
    for (const row of data) ids.push(row.id as string);
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

/** Deletes all synthetic agents by their IDs. */
async function deleteAgents(client: SupabaseClient, ids: string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    const { error } = await client.from('agents').delete().in('id', batch);
    if (error) {
      console.warn(
        `WARN: Failed to delete agent batch [${start}..${start + batch.length}]: ${error.message}`,
      );
    }
  }
}

/** Deletes all synthetic users by their IDs. */
async function deleteUsers(client: SupabaseClient, ids: string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    const { error } = await client.from('users').delete().in('id', batch);
    if (error) {
      console.warn(
        `WARN: Failed to delete user batch [${start}..${start + batch.length}]: ${error.message}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Recall computation via SQL
// ---------------------------------------------------------------------------

/**
 * Fetches top-K agent IDs ordered by vector cosine distance via PostgREST's
 * pgvector ordering support (?order=embedding.cd.<vector_literal>).
 *
 * This triggers the HNSW index when the WHERE clause matches the partial index
 * predicate (status=active, surface=dating, embedding IS NOT NULL).
 *
 * If PostgREST cannot execute the vector-ordered query (non-200 or empty/error
 * response), this function throws an error — callers MUST NOT silently fall
 * back to brute-force, as that would produce recall=1.0 (a false pass).
 *
 * If your Supabase version does not support PostgREST vector ordering, add an
 * RPC function to your schema:
 *
 *   create or replace function match_candidates_top_k_for_validation(
 *     query_embedding vector,
 *     k int,
 *     candidate_ids uuid[]
 *   ) returns table (id uuid)
 *   language sql stable security definer set search_path = public as $$
 *     select id from public.agents
 *     where id = any(candidate_ids)
 *       and status = 'active' and surface = 'dating'
 *     order by embedding <=> query_embedding
 *     limit k;
 *   $$;
 *
 * Then replace the fetch below with:
 *   client.rpc('match_candidates_top_k_for_validation', {
 *     query_embedding: queryVec,
 *     k: K,
 *     candidate_ids: insertedIds,
 *   })
 */
async function hnswTopKViaPostgREST(queryVec: number[], insertedIds: string[]): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const vectorParam = encodeURIComponent(toVectorLiteral(queryVec));
  // PostgREST IN filter for UUIDs: id=in.(uuid1,uuid2,...)
  const idList = insertedIds.join(',');

  const apiUrl =
    `${url}/rest/v1/agents` +
    `?select=id` +
    `&status=eq.active` +
    `&surface=eq.dating` +
    `&embedding=not.is.null` +
    `&id=in.(${idList})` +
    `&order=embedding.cd.${vectorParam}` +
    `&limit=${K}`;

  let resp: Response;
  try {
    resp = await fetch(apiUrl, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    throw new Error(
      'Unable to issue pgvector-ordered query through PostgREST; consider using a ' +
        'direct postgres connection or apply migration to add an HNSW-ordered RPC. ' +
        'See script comment for options.\n' +
        `Underlying fetch error: ${(err as Error).message}`,
    );
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '(unreadable body)');
    throw new Error(
      'Unable to issue pgvector-ordered query through PostgREST; consider using a ' +
        'direct postgres connection or apply migration to add an HNSW-ordered RPC. ' +
        `See script comment for options.\nHTTP ${resp.status}: ${body}`,
    );
  }

  const json = (await resp.json()) as Array<{ id: string }>;

  if (!Array.isArray(json)) {
    throw new Error(
      'Unable to issue pgvector-ordered query through PostgREST; consider using a ' +
        'direct postgres connection or apply migration to add an HNSW-ordered RPC. ' +
        'See script comment for options.\nUnexpected response shape: ' +
        JSON.stringify(json).slice(0, 200),
    );
  }

  // Empty result is legitimate when all candidates are filtered out, but
  // for our synthetic data every agent matches status=active & surface=dating.
  // An empty result here indicates the index ordering failed silently.
  if (json.length === 0 && insertedIds.length >= K) {
    throw new Error(
      'Unable to issue pgvector-ordered query through PostgREST; consider using a ' +
        'direct postgres connection or apply migration to add an HNSW-ordered RPC. ' +
        'See script comment for options.\nPostgREST returned 0 rows for a non-empty ' +
        'candidate set — vector ordering may not be supported.',
    );
  }

  return json.map((r) => r.id);
}

/**
 * Fetches top-K IDs by cosine distance client-side (exact brute-force).
 * Both vectors are L2-normalized so dot product = cosine similarity.
 */
function bruteForceTopK(embeddingMap: Map<string, number[]>, queryVec: number[]): string[] {
  const scores: Array<{ id: string; dist: number }> = [];

  for (const [id, vec] of embeddingMap.entries()) {
    let dot = 0;
    for (let i = 0; i < queryVec.length; i++) dot += queryVec[i] * vec[i];
    // cosine_distance = 1 - cosine_similarity (both vectors are normalized)
    scores.push({ id, dist: 1 - dot });
  }

  scores.sort((a, b) => a.dist - b.dist);
  return scores.slice(0, K).map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Main validation logic
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== HNSW Recall Validator ===');
  console.log(
    `Config: N_AGENTS=${N_AGENTS}, N_QUERIES=${N_QUERIES}, K=${K}, threshold=${RECALL_THRESHOLD}`,
  );
  console.log('');

  const client = makeClient();

  // Verify connectivity.
  console.log('Checking Supabase connectivity...');
  try {
    const { error } = await client.from('agents').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows — that's fine.
      throw new Error(error.message);
    }
  } catch (err) {
    console.error('ERROR: Cannot connect to Supabase:', (err as Error).message);
    console.error('Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(2);
  }
  console.log('Connection OK.');
  console.log('');

  // Generate synthetic data.
  console.log(`Generating ${N_AGENTS} synthetic user + agent rows...`);
  const { userRows, agentRowTemplates, vectors } = generateSyntheticData();
  const embeddingMap = new Map<string, number[]>();

  const insertedUserIds: string[] = [];
  let insertedAgentIds: string[] = [];

  try {
    // Step 1: Insert users first (agents.user_id FK requires users to exist).
    console.log('Inserting synthetic users into users table...');
    const insertedUsersData: Array<{ id: string; nullifier: string }> = [];
    for (let start = 0; start < userRows.length; start += BATCH_SIZE) {
      const batch = userRows.slice(start, start + BATCH_SIZE);
      const { data, error } = await client.from('users').insert(batch).select('id, nullifier');
      if (error) {
        throw new Error(
          `Failed to insert user batch [${start}..${start + batch.length}]: ${error.message}`,
        );
      }
      if (!data) throw new Error('User insert returned no data');
      for (const row of data) {
        insertedUserIds.push(row.id as string);
        insertedUsersData.push({ id: row.id as string, nullifier: row.nullifier as string });
      }
    }
    console.log(`Inserted ${insertedUserIds.length} users.`);

    // Build nullifier → user_id map for agent row construction.
    const userIdByNullifier = new Map<string, string>();
    for (const u of insertedUsersData) {
      userIdByNullifier.set(u.nullifier, u.id);
    }

    // Step 2: Insert agents (FK satisfied).
    console.log('Inserting synthetic agents into agents table...');
    insertedAgentIds = await insertAgents(client, agentRowTemplates, userIdByNullifier);
    console.log(`Inserted ${insertedAgentIds.length} agents.`);

    // Build agent_id -> embedding map using insertion order.
    // agentRowTemplates and insertedAgentIds are parallel arrays.
    for (let i = 0; i < insertedAgentIds.length; i++) {
      embeddingMap.set(insertedAgentIds[i], vectors[i]);
    }

    // Step 3: Run recall evaluation.
    console.log(`\nRunning ${N_QUERIES} recall evaluations...`);
    const recalls: number[] = [];

    for (let q = 0; q < N_QUERIES; q++) {
      const queryVec = randomVector(EMBEDDING_DIM);

      // HNSW top-K (DB-side, index-driven via PostgREST vector ordering).
      // Throws with exit-2 error if PostgREST cannot execute the ordered query.
      const hnswIds = await hnswTopKViaPostgREST(queryVec, insertedAgentIds);

      // Brute-force top-K (exact, client-side).
      const bruteIds = bruteForceTopK(embeddingMap, queryVec);

      // Recall@K = intersection / K.
      const hnswSet = new Set(hnswIds);
      const intersection = bruteIds.filter((id) => hnswSet.has(id)).length;
      const recall = intersection / K;
      recalls.push(recall);

      if ((q + 1) % 10 === 0) {
        const avgSoFar = recalls.reduce((a, b) => a + b, 0) / recalls.length;
        console.log(`  Query ${q + 1}/${N_QUERIES}: running avg recall = ${avgSoFar.toFixed(4)}`);
      }
    }

    // Compute final average recall.
    const avgRecall = recalls.reduce((a, b) => a + b, 0) / recalls.length;
    const minRecall = Math.min(...recalls);
    const maxRecall = Math.max(...recalls);

    console.log('\n=== Results ===');
    console.log(`  Queries evaluated : ${N_QUERIES}`);
    console.log(`  Avg recall@${K}    : ${avgRecall.toFixed(4)}`);
    console.log(`  Min recall@${K}    : ${minRecall.toFixed(4)}`);
    console.log(`  Max recall@${K}    : ${maxRecall.toFixed(4)}`);
    console.log(`  Threshold         : ${RECALL_THRESHOLD}`);
    console.log('');

    const passed = avgRecall >= RECALL_THRESHOLD;
    if (passed) {
      console.log(`PASS: avg recall@${K} = ${avgRecall.toFixed(4)} >= ${RECALL_THRESHOLD}`);
    } else {
      console.error(`FAIL: avg recall@${K} = ${avgRecall.toFixed(4)} < ${RECALL_THRESHOLD}`);
      console.error('Action: consider increasing hnsw.ef_search or rebuilding the index.');
    }

    // Cleanup before exit (in finally below).
    process.exitCode = passed ? 0 : 1;
  } catch (err) {
    const msg = (err as Error).message;
    console.error('\nERROR during validation:', msg);
    process.exitCode = 2;
  } finally {
    // Cleanup MUST happen even on failure.
    console.log('\nCleaning up inserted rows...');
    if (insertedAgentIds.length > 0) {
      try {
        await deleteAgents(client, insertedAgentIds);
        console.log(`Deleted ${insertedAgentIds.length} agents.`);
      } catch (cleanErr) {
        console.warn('WARN: Agent cleanup failed:', (cleanErr as Error).message);
        console.warn(
          `Manually run: DELETE FROM public.agents WHERE id IN (${insertedAgentIds.slice(0, 3).join(', ')}, ...)`,
        );
      }
    }
    if (insertedUserIds.length > 0) {
      try {
        await deleteUsers(client, insertedUserIds);
        console.log(`Deleted ${insertedUserIds.length} users.`);
      } catch (cleanErr) {
        console.warn('WARN: User cleanup failed:', (cleanErr as Error).message);
        console.warn(
          `Manually run: DELETE FROM public.users WHERE nullifier LIKE 'test_nullifier_%'`,
        );
      }
    }
    console.log('Cleanup complete.');
  }
}

main();
