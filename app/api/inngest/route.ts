import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { nightlyMatch } from '@/lib/inngest/functions/nightly-match';
import { liveConversation } from '@/lib/inngest/functions/live-conversation';
import { generateReport } from '@/lib/inngest/functions/generate-report';
import { firstEncounter } from '@/lib/inngest/functions/first-encounter';
import { dailyDigest } from '@/lib/inngest/functions/daily-digest';
import { mutualPush } from '@/lib/inngest/functions/mutual-push';
import { costCapSettlement, costCapAlert } from '@/lib/inngest/functions/cost-cap';
import { cohortRotate } from '@/lib/inngest/functions/cohort-rotate';
import { cleanupOrphans } from '@/lib/inngest/functions/cleanup-orphans';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    nightlyMatch,
    liveConversation,
    generateReport,
    firstEncounter,
    dailyDigest,
    mutualPush,
    costCapSettlement,
    costCapAlert,
    cohortRotate,
    cleanupOrphans,
  ],
});
