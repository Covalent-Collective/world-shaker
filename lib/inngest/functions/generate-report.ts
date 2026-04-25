import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';
import { isEnabled } from '@/lib/flags';
import { buildReportPrompt, ReportSchema } from '@/lib/llm/prompts/report';
import { buildFirstMessagePrompt, FirstMessageSchema } from '@/lib/llm/prompts/first-message';
import { DEFAULT_CHAT_MODEL } from '@/lib/llm/openrouter';
import type { PersonaProfile } from '@/lib/llm/prompts/types';
import type { Agent, Conversation, ConversationTurn } from '@/types/db';
import OpenAI from 'openai';

/**
 * One-shot (non-streaming) chat completion via OpenRouter.
 * Used for report and first-message generation where full JSON is needed before proceeding.
 */
async function callOpenRouterJson(system: string, userContent: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://world-shaker.local',
      'X-Title': 'World Shaker',
    },
  });

  const res = await client.chat.completions.create({
    model: DEFAULT_CHAT_MODEL,
    response_format: { type: 'json_object' },
    max_tokens: 900,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  });

  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error('llm_empty_response');
  return content;
}

export const generateReport = inngest.createFunction(
  {
    id: 'generate-report',
    name: 'Generate Post-Conversation Report',
    triggers: [{ event: 'conversation.completed' }],
  },
  async ({ event, step, logger }) => {
    const { conversation_id } = event.data as { conversation_id: string };
    const supabase = getServiceClient();

    // Step 1: Load conversation row (must be completed, have both agents + surface)
    const conversation = await step.run('load-conversation', async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, agent_a_id, agent_b_id, surface, status')
        .eq('id', conversation_id)
        .eq('status', 'completed')
        .single();

      if (error || !data) throw new Error(`conversation_not_found: ${conversation_id}`);
      if (!data.agent_a_id || !data.agent_b_id) {
        throw new Error(`conversation_missing_agents: ${conversation_id}`);
      }
      return data as Conversation;
    });

    // Step 2: Load both agents (extracted_features, user_id)
    const [agentA, agentB] = await step.run('load-agents', async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('id, user_id, extracted_features')
        .in('id', [conversation.agent_a_id, conversation.agent_b_id]);

      if (error || !data || data.length < 2) {
        throw new Error(`agents_not_found for conversation: ${conversation_id}`);
      }

      const a = data.find(
        (ag: Pick<Agent, 'id' | 'user_id' | 'extracted_features'>) =>
          ag.id === conversation.agent_a_id,
      );
      const b = data.find(
        (ag: Pick<Agent, 'id' | 'user_id' | 'extracted_features'>) =>
          ag.id === conversation.agent_b_id,
      );
      if (!a || !b) throw new Error('agent_id_mismatch');
      return [a, b] as [
        Pick<Agent, 'id' | 'user_id' | 'extracted_features'>,
        Pick<Agent, 'id' | 'user_id' | 'extracted_features'>,
      ];
    });

    // Step 3: Load all conversation turns ordered by turn_index
    const turns = await step.run('load-turns', async () => {
      const { data, error } = await supabase
        .from('conversation_turns')
        .select('id, conversation_id, turn_index, speaker_agent_id, text')
        .eq('conversation_id', conversation_id)
        .order('turn_index', { ascending: true });

      if (error) throw new Error(`turns_load_error: ${error.message}`);
      return (data ?? []) as Pick<
        ConversationTurn,
        'id' | 'conversation_id' | 'turn_index' | 'speaker_agent_id' | 'text'
      >[];
    });

    // Step 4: Build transcript with speaker labels A / B
    const transcript = turns.map((t) => ({
      speaker: t.speaker_agent_id === agentA.id ? ('A' as const) : ('B' as const),
      text: t.text,
    }));

    // Step 5: Call match_candidates RPC to get baseline_score
    const baselineScore = await step.run('get-baseline-score', async () => {
      const { data, error } = await supabase.rpc('match_candidates', {
        target_user: agentA.user_id,
        k: 100,
        mode: 'system_generated',
      });

      if (error) {
        logger.warn(`match_candidates rpc failed: ${error.message}; using 0.5 fallback`);
        return 0.5;
      }

      const results = data as Array<{ user_id: string; score: number }> | null;
      const entry = results?.find((r) => r.user_id === agentB.user_id);
      return entry?.score ?? 0.5;
    });

    // Step 6-7: Build report prompt and call OpenRouter (with one retry on invalid JSON)
    const reportOutput = await step.run('generate-report-llm', async () => {
      const language = isEnabled('BILINGUAL_PROMPTS_V1') ? 'ko' : 'ko'; // default ko per spec
      const personaA: PersonaProfile = { extracted_features: agentA.extracted_features };
      const personaB: PersonaProfile = { extracted_features: agentB.extracted_features };

      const promptResult = buildReportPrompt({
        transcript,
        persona_a: personaA,
        persona_b: personaB,
        baseline_score: baselineScore,
        language,
      });

      let raw = await callOpenRouterJson(
        promptResult.system,
        promptResult.messages[0]?.content ?? '',
      );

      let parsed = ReportSchema.safeParse(JSON.parse(raw));

      if (!parsed.success) {
        logger.warn('report_json_invalid on first try; retrying with stricter prompt');
        const strictSystem =
          promptResult.system +
          '\n\nCRITICAL: Your previous response did not match the required schema. ' +
          'Respond ONLY with valid JSON matching the schema exactly. No extra fields.';
        raw = await callOpenRouterJson(strictSystem, promptResult.messages[0]?.content ?? '');
        parsed = ReportSchema.safeParse(JSON.parse(raw));
      }

      if (!parsed.success) {
        throw new Error(`report_schema_invalid: ${parsed.error.message}`);
      }

      return parsed.data;
    });

    // Step 8: Build first-message prompt and parse 2 starters
    const starters = await step.run('generate-starters-llm', async () => {
      const language = isEnabled('BILINGUAL_PROMPTS_V1') ? 'ko' : 'ko';
      const personaA: PersonaProfile = { extracted_features: agentA.extracted_features };
      const personaB: PersonaProfile = { extracted_features: agentB.extracted_features };

      const promptResult = buildFirstMessagePrompt({
        transcript,
        persona_a: personaA,
        persona_b: personaB,
        language,
      });

      const raw = await callOpenRouterJson(
        promptResult.system,
        promptResult.messages[0]?.content ?? '',
      );

      // FirstMessageSchema expects an array — the LLM may return {"starters": [...]} or [...]
      let parsed = FirstMessageSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        // Fallback: try unwrapping common wrapper keys
        const obj = JSON.parse(raw) as Record<string, unknown>;
        const candidate =
          obj['starters'] ?? obj['messages'] ?? obj['data'] ?? obj['result'] ?? null;
        if (Array.isArray(candidate)) {
          parsed = FirstMessageSchema.safeParse(candidate);
        }
      }

      if (!parsed.success) {
        throw new Error(`starters_schema_invalid: ${parsed.error.message}`);
      }

      return parsed.data.map((text: string) => ({ text }));
    });

    // Step 9 & 10: Insert match rows for both directions (A→B and B→A)
    const { matchAId, matchBId } = await step.run('insert-match-rows', async () => {
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const baseRow = {
        conversation_id,
        compatibility_score: reportOutput.compatibility_score,
        why_click: reportOutput.why_click,
        watch_out: reportOutput.watch_out,
        highlight_quotes: reportOutput.highlight_quotes,
        rendered_transcript: transcript,
        status: 'pending',
        origin: 'system_generated',
        starters,
        first_encounter: true,
        created_at: now,
        accepted_at: null,
        expires_at: expiresAt,
        world_chat_link: null,
      };

      const { data: rowA, error: errorA } = await supabase
        .from('matches')
        .insert({ ...baseRow, user_id: agentA.user_id, candidate_user_id: agentB.user_id })
        .select('id')
        .single();

      if (errorA || !rowA) throw new Error(`match_insert_a_failed: ${errorA?.message}`);

      const { data: rowB, error: errorB } = await supabase
        .from('matches')
        .insert({ ...baseRow, user_id: agentB.user_id, candidate_user_id: agentA.user_id })
        .select('id')
        .single();

      if (errorB || !rowB) throw new Error(`match_insert_b_failed: ${errorB?.message}`);

      return { matchAId: rowA.id as string, matchBId: rowB.id as string };
    });

    // Step 11: Emit match.created events for both rows
    await step.sendEvent('emit-match-created', [
      { name: 'match.created', data: { match_id: matchAId } },
      { name: 'match.created', data: { match_id: matchBId } },
    ]);

    logger.info(
      `generate-report complete conversation=${conversation_id} match_a=${matchAId} match_b=${matchBId}`,
    );

    return { conversation_id, match_a_id: matchAId, match_b_id: matchBId };
  },
);
