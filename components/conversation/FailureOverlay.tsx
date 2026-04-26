'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/useT';

interface FailureOverlayProps {
  conversationId: string;
}

/**
 * Conversation failure overlay (US-307 / Step 3.6 / Step 4.5 / AC-16).
 *
 * Rendered by LiveTranscript when the SSE stream emits a `failed` event or
 * the server reports `conversations.status='failed'`.
 *
 *   - Restart: POST /api/conversation/[id]/restart → server allocates a new
 *     attempt for the same agent pair via Inngest. Client returns to home
 *     where the recovery placeholder polls for the new live row.
 *   - Close: POST /api/conversation/[id]/abandon → router.push('/').
 */
export default function FailureOverlay({
  conversationId,
}: FailureOverlayProps): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<'restart' | 'close' | null>(null);

  const handleRestart = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy('restart');
    try {
      await fetch(`/api/conversation/${conversationId}/restart`, { method: 'POST' });
      router.push('/');
    } finally {
      setBusy(null);
    }
  };

  const handleClose = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy('close');
    try {
      await fetch(`/api/conversation/${conversationId}/abandon`, { method: 'POST' });
      router.push('/');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('conversation.failure_overlay.restart')}</DialogTitle>
          <DialogDescription>{t('conversation.failure_overlay.close')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="primary"
            block
            disabled={busy !== null}
            onClick={handleRestart}
          >
            {t('conversation.failure_overlay.restart')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            block
            disabled={busy !== null}
            onClick={handleClose}
          >
            {t('conversation.failure_overlay.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
