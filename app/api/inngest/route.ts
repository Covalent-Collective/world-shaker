import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { nightlyMatch } from '@/lib/inngest/functions/nightly-match';
import { liveConversation } from '@/lib/inngest/functions/live-conversation';
import { generateReport } from '@/lib/inngest/functions/generate-report';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [nightlyMatch, liveConversation, generateReport],
});
