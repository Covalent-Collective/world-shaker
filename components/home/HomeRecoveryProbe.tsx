'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface HomeRecoveryProbeProps {
  agentId: string;
}

/**
 * HomeRecoveryProbe — client component.
 *
 * On mount, POSTs to /api/first-encounter/recover to trigger a recovery
 * attempt for users who have an agent but no conversation yet.
 * Refreshes the router after 1 s on success so the server component
 * re-evaluates the decision tree.
 */
export default function HomeRecoveryProbe({ agentId }: HomeRecoveryProbeProps): null {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function probe(): Promise<void> {
      try {
        const res = await fetch('/api/first-encounter/recover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId }),
        });

        if (res.ok && !cancelled) {
          setTimeout(() => {
            if (!cancelled) router.refresh();
          }, 1000);
        }
      } catch {
        // Silently ignore — recovery is best-effort.
      }
    }

    void probe();

    return () => {
      cancelled = true;
    };
  }, [agentId, router]);

  return null;
}
