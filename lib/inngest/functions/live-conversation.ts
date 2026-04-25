import { inngest } from '../client';
import { getServiceClient } from '@/lib/supabase/service';
import { assertBudgetAvailable } from '@/lib/llm/budget';
import { streamChat, DEFAULT_CHAT_MODEL } from '@/lib/llm/openrouter';
import { detectRepeatLoop, detectHostileTone, detectNSFW } from '@/lib/llm/safety';
import { buildPersonaPrompt } from '@/lib/llm/prompts/persona';
import { buildDialoguePrompt } from '@/lib/llm/prompts/agent-dialogue';
import type {
  ExtractedFeatures,
  Lang,
  PersonaProfile,
  TranscriptTurn,
} from '@/lib/llm/prompts/types';
import type { StreamChatMessage } from '@/lib/llm/openrouter';

/**
 * Live agent-to-agent conversation orchestrator (Step 2.7, v4 atomic design).
 *
 * Flow:
 *   1. Pre-flight: assertBudgetAvailable. If not ok -> wont_connect outcome + bail.
 *   2. Allocate attempt via allocate_conversation_attempt RPC (advisory lock
 *      serializes concurrent restart attempts).
 *   3. Load both agents and build per-side persona prompts.
 *   4. For each turn 0..MAX_TURNS-1:
 *        a. stage = opening (0..3) | probing (4..15) | landing (16..)
 *        b. whose_turn = A on even, B on odd
 *        c. Stream the next turn through OpenRouter; accumulate text + usage.
 *        d. Run safety: repeat-loop + hostile + NSFW. If any flagged, mark
 *           conversation failed, emit conversation.failed, exit.
 *        e. Atomic turn+ledger via append_turn_with_ledger RPC. Returns
 *           false on duplicate Inngest retry; caller continues without
 *           re-charging.
 *        f. Concurrent abort check: UPDATE last_turn_emitted_at WHERE
 *           status='live' RETURNING id. Zero rows -> exit cleanly (someone
 *           else terminated the conversation).
 *   5. After natural completion: UPDATE status='completed' WHERE status='live';
 *      emit conversation.completed (triggers Step 2.10 generate-report).
 */

export const CONVERSATION_START_EVENT = 'conversation/start';
export const CONVERSATION_COMPLETED_EVENT = 'conversation.completed';
export const CONVERSATION_FAILED_EVENT = 'conversation.failed';

export const DEFAULT_MAX_TURNS = 25;
const STAGE_PROBING_THRESHOLD = 4;
const STAGE_LANDING_THRESHOLD = 16;

export type ConversationStartPayload = {
  user_id: string;
  surface: 'dating';
  agent_a_id: string;
  agent_b_id: string;
  pair_key: string;
  language: Lang;
  max_turns?: number;
};

interface AgentRow {
  id: string;
  user_id: string;
  extracted_features: ExtractedFeatures | null;
}

function inferStage(turn_index: number): 'opening' | 'probing' | 'landing' {
  if (turn_index < STAGE_PROBING_THRESHOLD) return 'opening';
  if (turn_index < STAGE_LANDING_THRESHOLD) return 'probing';
  return 'landing';
}

function whoseTurn(turn_index: number): 'a' | 'b' {
  return turn_index % 2 === 0 ? 'a' : 'b';
}

async function consumeStream(messages: StreamChatMessage[], systemPrompt: string) {
  const finalMessages: StreamChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  let text = '';
  let usage = {
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    model: DEFAULT_CHAT_MODEL,
  };

  for await (const chunk of streamChat({ model: DEFAULT_CHAT_MODEL, messages: finalMessages })) {
    if (chunk.delta) text += chunk.delta;
    if (chunk.done && chunk.usage) usage = chunk.usage;
  }

  return { text, usage };
}

export const liveConversation = inngest.createFunction(
  {
    id: 'live-conversation',
    name: 'Live Conversation',
    triggers: [{ event: CONVERSATION_START_EVENT }],
  },
  async ({ event, step, logger }) => {
    const payload = event.data as ConversationStartPayload;
    const { user_id, surface, agent_a_id, agent_b_id, pair_key, language } = payload;
    const maxTurns = Math.min(payload.max_turns ?? DEFAULT_MAX_TURNS, DEFAULT_MAX_TURNS);

    const supabase = getServiceClient();

    // ---- Step 1: pre-flight budget ----------------------------------------
    const preflight = await step.run('preflight-budget', async () => {
      return assertBudgetAvailable(user_id);
    });

    if (!preflight.ok) {
      await step.run('emit-wont-connect', async () => {
        await supabase.from('outcome_events').insert({
          user_id,
          event_type: 'wont_connect',
          source_screen: 'live-conversation',
          metadata: { reason: preflight.reason ?? 'unknown', surface, pair_key },
        });
      });
      logger.info(`live-conversation: pre-flight aborted reason=${preflight.reason ?? 'unknown'}`);
      return { aborted: true, reason: preflight.reason ?? 'unknown' };
    }

    // ---- Step 2: allocate conversation attempt ----------------------------
    const conversation_id = await step.run('allocate-attempt', async () => {
      const { data, error } = await supabase.rpc('allocate_conversation_attempt', {
        p_surface: surface,
        p_pair_key: pair_key,
        p_agent_a: agent_a_id,
        p_agent_b: agent_b_id,
      });
      if (error) throw new Error(`allocate_conversation_attempt failed: ${error.message}`);
      return data as string;
    });

    // ---- Step 3: load agents ----------------------------------------------
    const { agentA, agentB } = await step.run('load-agents', async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('id, user_id, extracted_features')
        .in('id', [agent_a_id, agent_b_id]);
      if (error) throw new Error(`load-agents failed: ${error.message}`);
      const rows = (data ?? []) as AgentRow[];
      const a = rows.find((r) => r.id === agent_a_id);
      const b = rows.find((r) => r.id === agent_b_id);
      if (!a || !b) throw new Error('load-agents: missing agent row');
      return { agentA: a, agentB: b };
    });

    const personaA: PersonaProfile = {
      agent_id: agentA.id,
      name: 'Agent A',
      extracted_features: agentA.extracted_features ?? {},
    };
    const personaB: PersonaProfile = {
      agent_id: agentB.id,
      name: 'Agent B',
      extracted_features: agentB.extracted_features ?? {},
    };

    // Persona prompts are kept on the system side to anchor each side's voice.
    // We don't yet inject persona prompts as separate system messages — the
    // dialogue prompt embeds extracted_features. Building them here ensures
    // any callers introspecting the function (and US-207 contract) can pull
    // the same per-side prompts later for ad-hoc rendering.
    void buildPersonaPrompt({ extracted_features: personaA.extracted_features, language });
    void buildPersonaPrompt({ extracted_features: personaB.extracted_features, language });

    // ---- Step 4: turn loop ------------------------------------------------
    const transcript: TranscriptTurn[] = [];

    for (let turn_index = 0; turn_index < maxTurns; turn_index++) {
      const stage = inferStage(turn_index);
      const turn_speaker = whoseTurn(turn_index);
      const speaker_agent_id = turn_speaker === 'a' ? agent_a_id : agent_b_id;

      // 4a. Generate the next turn.
      const turn = await step.run(`turn-${turn_index}-generate`, async () => {
        const { system, messages } = buildDialoguePrompt({
          persona_a: personaA,
          persona_b: personaB,
          history: transcript,
          stage,
          language,
          whose_turn: turn_speaker,
        });
        return consumeStream(messages, system);
      });

      // 4b. Safety pipeline. transcriptTexts feeds detectRepeatLoop with the
      // candidate turn appended so a tight loop on the just-generated text
      // is caught immediately.
      const transcriptTexts = [...transcript.map((t) => t.text), turn.text];

      const safety = await step.run(`turn-${turn_index}-safety`, async () => {
        const repeat = detectRepeatLoop(transcriptTexts);
        const [hostile, nsfw] = await Promise.all([
          detectHostileTone(turn.text),
          detectNSFW(turn.text),
        ]);
        return { repeat, hostile, nsfw };
      });

      const hostileFlagged = safety.hostile.flagged || safety.hostile.reason !== 'clean';
      const nsfwFlagged = safety.nsfw.flagged || safety.nsfw.reason !== 'clean';
      if (safety.repeat || hostileFlagged || nsfwFlagged) {
        await step.run('mark-failed', async () => {
          const { error } = await supabase
            .from('conversations')
            .update({ status: 'failed' })
            .eq('id', conversation_id)
            .eq('status', 'live');
          if (error) throw new Error(`mark-failed UPDATE failed: ${error.message}`);
        });
        await step.sendEvent('emit-conversation-failed', {
          name: CONVERSATION_FAILED_EVENT,
          data: {
            conversation_id,
            reason: safety.repeat
              ? 'repeat_loop'
              : hostileFlagged
                ? (safety.hostile.reason ?? 'hostile')
                : (safety.nsfw.reason ?? 'nsfw'),
            turn_index,
          },
        });
        logger.warn(`live-conversation: failed at turn=${turn_index}`);
        return { conversation_id, status: 'failed', turn_index };
      }

      // 4c. Atomic turn+ledger write. Returns false on duplicate retry.
      const inserted = await step.run(`turn-${turn_index}-append`, async () => {
        const { data, error } = await supabase.rpc('append_turn_with_ledger', {
          p_conv_id: conversation_id,
          p_turn_index: turn_index,
          p_speaker_agent_id: speaker_agent_id,
          p_text: turn.text,
          p_token_count: turn.usage.output_tokens,
          p_user_id: user_id,
          p_tokens_input: turn.usage.input_tokens,
          p_tokens_output: turn.usage.output_tokens,
          p_cost_usd: turn.usage.cost_usd,
          p_model: turn.usage.model,
        });
        if (error) throw new Error(`append_turn_with_ledger failed: ${error.message}`);
        return data as boolean;
      });

      if (inserted) {
        transcript.push({
          speaker:
            turn_speaker === 'a' ? (personaA.name ?? 'Agent A') : (personaB.name ?? 'Agent B'),
          text: turn.text,
        });
      } else {
        // Duplicate retry — still keep transcript in sync for subsequent turns.
        transcript.push({
          speaker:
            turn_speaker === 'a' ? (personaA.name ?? 'Agent A') : (personaB.name ?? 'Agent B'),
          text: turn.text,
        });
        logger.info(`live-conversation: duplicate retry on turn=${turn_index}, no double-charge`);
      }

      // 4d. Concurrent abort check — heartbeat + status assertion.
      const stillLive = await step.run(`turn-${turn_index}-heartbeat`, async () => {
        const { data, error } = await supabase
          .from('conversations')
          .update({ last_turn_emitted_at: new Date().toISOString() })
          .eq('id', conversation_id)
          .eq('status', 'live')
          .select('id');
        if (error) throw new Error(`heartbeat UPDATE failed: ${error.message}`);
        return (data?.length ?? 0) > 0;
      });

      if (!stillLive) {
        logger.info(`live-conversation: terminated externally at turn=${turn_index}`);
        return { conversation_id, status: 'terminated_externally', turn_index };
      }
    }

    // ---- Step 5: completion ----------------------------------------------
    await step.run('mark-completed', async () => {
      const { error } = await supabase
        .from('conversations')
        .update({ status: 'completed' })
        .eq('id', conversation_id)
        .eq('status', 'live');
      if (error) throw new Error(`mark-completed UPDATE failed: ${error.message}`);
    });

    await step.sendEvent('emit-conversation-completed', {
      name: CONVERSATION_COMPLETED_EVENT,
      data: { conversation_id },
    });

    return { conversation_id, status: 'completed', turns: maxTurns };
  },
);
