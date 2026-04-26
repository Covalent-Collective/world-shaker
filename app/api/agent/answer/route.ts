import 'server-only';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { rateLimit, agentAnswerRateLimit } from '@/lib/auth/rate-limit';
import { getServiceClient } from '@/lib/supabase/service';
import { buildInterviewProbePrompt, InterviewProbeSchema } from '@/lib/llm/prompts/interview-probe';
import { DEFAULT_CHAT_MODEL } from '@/lib/llm/openrouter';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const Body = z.object({
  skeleton_question_id: z.string(),
  answer: z.string(),
  request_probe: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Skeleton question text resolution.
// US-303 (lib/interview/skeleton.ts) is built in parallel. If it doesn't
// exist yet, fall back to using the skeleton_question_id as the question text.
// ---------------------------------------------------------------------------
async function resolveSkeletonQuestion(skeleton_question_id: string): Promise<string> {
  try {
    // TODO: replace with import from '@/lib/interview/skeleton' once US-303 lands.
    const { getSkeletonQuestion } = await import('@/lib/interview/skeleton');
    const question = await getSkeletonQuestion(skeleton_question_id);
    return question?.id ?? skeleton_question_id;
  } catch {
    // Fallback: use the question_id as the question text directly.
    return skeleton_question_id;
  }
}

// ---------------------------------------------------------------------------
// One-shot LLM call for probe generation (non-streaming).
// ---------------------------------------------------------------------------
function getOpenRouterClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');
  return new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://world-shaker.local',
      'X-Title': 'World Shaker',
    },
  });
}

async function generateProbes(args: {
  skeleton_question: string;
  user_answer: string;
  prior_answers: Record<string, string>;
  language: 'ko' | 'en';
}): Promise<string[]> {
  const { system, messages } = buildInterviewProbePrompt({
    skeleton_question: args.skeleton_question,
    user_answer: args.user_answer,
    prior_answers: Object.values(args.prior_answers),
    language: args.language,
  });

  const client = getOpenRouterClient();
  const res = await client.chat.completions.create({
    model: DEFAULT_CHAT_MODEL,
    response_format: { type: 'json_object' },
    max_tokens: 400,
    messages: [
      { role: 'system', content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error('llm_empty_response');

  const parsed = InterviewProbeSchema.parse(JSON.parse(content));
  return parsed;
}

/**
 * POST /api/agent/answer
 *
 * Persists an interview answer for the authenticated user and optionally
 * generates follow-up probe questions via LLM.
 *
 * Auth: ws_session cookie verified via verifyWorldUserJwt.
 * Rate limit: 30 req/60 s per user (agentAnswerRateLimit).
 *
 * Body: { skeleton_question_id, answer, request_probe? }
 * Response: { saved: true } | { saved: true, probes: string[] }
 */
export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let claims: Awaited<ReturnType<typeof verifyWorldUserJwt>>;
  try {
    claims = await verifyWorldUserJwt(token);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { world_user_id, language_pref } = claims;

  // ── Rate limit ────────────────────────────────────────────────────────────
  const rl = await rateLimit({
    world_user_id,
    bucket_key: 'agent_answer',
    ...agentAnswerRateLimit,
  });

  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  // ── Body validation ───────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const body = Body.safeParse(rawBody);
  if (!body.success) {
    return NextResponse.json(
      { error: 'invalid_body', detail: body.error.flatten() },
      { status: 400 },
    );
  }

  const { skeleton_question_id, answer, request_probe } = body.data;

  // ── Persist answer ────────────────────────────────────────────────────────
  const db = getServiceClient();

  // Read current interview_answers to merge the new answer in.
  const { data: row, error: readError } = await db
    .from('agents')
    .select('interview_answers')
    .eq('user_id', world_user_id)
    .single();

  if (readError) {
    console.error('[agent/answer] read agent row error', readError);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  const current = (row?.interview_answers as Record<string, string>) ?? {};
  const merged = { ...current, [skeleton_question_id]: answer };

  const { error: updErr } = await db
    .from('agents')
    .update({ interview_answers: merged })
    .eq('user_id', world_user_id);

  if (updErr) {
    console.error('[agent/answer] persist error', updErr);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  // ── Probe generation ──────────────────────────────────────────────────────
  if (!request_probe) {
    return NextResponse.json({ saved: true });
  }

  // `merged` already contains all answers including the one just saved.
  const prior_answers = merged;
  const skeleton_question = await resolveSkeletonQuestion(skeleton_question_id);

  try {
    const probes = await generateProbes({
      skeleton_question,
      user_answer: answer,
      prior_answers,
      language: language_pref,
    });
    return NextResponse.json({ saved: true, probes });
  } catch (err) {
    console.error('[agent/answer] probe generation error', err);
    return NextResponse.json({ error: 'probe_failed' }, { status: 500 });
  }
}
