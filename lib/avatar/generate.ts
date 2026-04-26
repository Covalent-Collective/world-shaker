import 'server-only';

import { createHash } from 'crypto';

import { getServiceClient } from '@/lib/supabase/service';

/**
 * Avatar generation for AI agents.
 *
 * ONE-SHOT POLICY (US-501, decided 2026-04-26):
 * An avatar is generated exactly once per agent at v0. If avatar_generated_at
 * is already set in the agents row, generateAvatar() returns the existing URL
 * immediately without making any external call or DB write. Regeneration is
 * deferred to v1.1 pending user feedback. See .omc/plans/open-questions.md.
 *
 * Image-model availability is uncertain at v0 (see .omc/plans/open-questions.md,
 * "OpenRouter image generation model choice"). The implementation is gated on
 * the OPENROUTER_IMAGE_MODEL env var:
 *
 *   - Set: calls OpenRouter image API (POST /images/generations) and stores
 *     the returned URL. placeholder=false.
 *   - Unset: computes a deterministic placeholder path from a sha256 hash of
 *     the serialised features so each agent gets a stable, unique placeholder
 *     without any external call. placeholder=true.
 *
 * After the URL is determined, agents.avatar_url and agents.avatar_generated_at
 * are written via the service-role client (bypasses RLS).
 *
 * This file is listed in .omc/plans/service-client-allowlist.txt.
 */

export interface GenerateAvatarInput {
  agent_id: string;
  extracted_features: Record<string, unknown>;
}

export interface GenerateAvatarResult {
  url: string;
  placeholder: boolean;
}

/**
 * Build a text prompt for the image model from agent feature data.
 * Converts the feature map to a descriptive sentence for stylised avatar generation.
 */
function buildImagePrompt(features: Record<string, unknown>): string {
  const parts = Object.entries(features)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return `Stylised portrait avatar for an AI agent. Characteristics — ${parts.join(', ')}.`;
}

/**
 * Compute a 12-char hex prefix from the sha256 of the serialised features.
 * Deterministic: same features always produce the same placeholder path.
 */
function placeholderHash(features: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(features)).digest('hex').slice(0, 12);
}

/**
 * Generate (or derive a placeholder for) an avatar for an agent.
 *
 * Writes avatar_url + avatar_generated_at back to the agents row via
 * the service-role Supabase client.
 */
export async function generateAvatar(input: GenerateAvatarInput): Promise<GenerateAvatarResult> {
  const { agent_id, extracted_features } = input;

  // ONE-SHOT GUARD: if the agent already has an avatar, return it immediately.
  // avatar_generated_at is immutable after first write (US-501 policy).
  const db = getServiceClient();
  const { data: existing, error: selectError } = await db
    .from('agents')
    .select('avatar_url, avatar_generated_at')
    .eq('id', agent_id)
    .single();

  if (selectError && selectError.code !== 'PGRST116') {
    throw new Error(`avatar_db_select_error: ${selectError.message}`);
  }

  if (existing?.avatar_generated_at) {
    const existingUrl = existing.avatar_url as string;
    const isPlaceholder = existingUrl.startsWith('/avatars/placeholder/');
    return { url: existingUrl, placeholder: isPlaceholder };
  }

  let url: string;
  let placeholder: boolean;

  const imageModel = process.env.OPENROUTER_IMAGE_MODEL;

  if (imageModel) {
    // Real image generation via OpenRouter images endpoint.
    // Gating: OPENROUTER_IMAGE_MODEL must be set (see open-questions.md).
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');

    const prompt = buildImagePrompt(extracted_features);

    const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://world-shaker.local',
        'X-Title': 'World Shaker',
      },
      body: JSON.stringify({
        model: imageModel,
        prompt,
        n: 1,
        size: '256x256',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`openrouter_image_api_error: ${response.status} ${text}`);
    }

    const json = (await response.json()) as { data: Array<{ url: string }> };
    const imageUrl = json.data[0]?.url;
    if (!imageUrl) throw new Error('openrouter_image_empty_response');

    url = imageUrl;
    placeholder = false;
  } else {
    // Deterministic placeholder — no external call required.
    // Hash is stable so regenerating without the env var always returns the
    // same path for the same feature set.
    const hash = placeholderHash(extracted_features);
    url = `/avatars/placeholder/${hash}.png`;
    placeholder = true;
  }

  // Persist the URL to the agents row.
  const { error } = await db
    .from('agents')
    .update({ avatar_url: url, avatar_generated_at: new Date().toISOString() })
    .eq('id', agent_id);

  if (error) throw new Error(`avatar_db_update_error: ${error.message}`);

  return { url, placeholder };
}
