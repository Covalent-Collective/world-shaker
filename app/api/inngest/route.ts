import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { nightlyMatch } from '@/lib/inngest/functions/nightly-match';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [nightlyMatch],
});
