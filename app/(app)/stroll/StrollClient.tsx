'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import CardStack from '@/components/stroll/CardStack';
import type { StrollCandidate } from '@/components/stroll/CardStack';

interface StrollClientProps {
  candidates: StrollCandidate[];
  quotaRemaining: number;
}

interface SpawnResponse {
  conversation_id_pending?: boolean;
  conversation_id?: string;
  error?: string;
  reason?: string;
}

/**
 * Client shell for the Daily Stroll page.
 *
 * Renders the CardStack and handles the tap-to-spawn flow:
 *   1. POST /api/stroll/spawn with { candidate_agent_id }.
 *   2. On 200, navigate to the conversation (or pending route).
 *   3. On error, show a toast.
 */
export default function StrollClient({
  candidates,
  quotaRemaining,
}: StrollClientProps): React.ReactElement {
  const router = useRouter();
  const [loading, setLoading] = React.useState<boolean>(false);

  async function handleTap(candidateAgentId: string): Promise<void> {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/stroll/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate_agent_id: candidateAgentId }),
      });

      const data = (await res.json()) as SpawnResponse;

      if (!res.ok) {
        const reason = data.reason ?? data.error ?? `error_${res.status}`;
        toast.error(reason);
        return;
      }

      // Navigate to the conversation. If a concrete id is available use it,
      // otherwise use the 'pending' placeholder route so the client can poll.
      const convId = data.conversation_id ?? 'pending';
      router.push(`/conversation/${convId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 p-6">
      <p className="text-xs font-semibold text-text-3">{quotaRemaining} left today</p>
      <CardStack candidates={candidates} onTap={(id) => void handleTap(id)} />
    </main>
  );
}
