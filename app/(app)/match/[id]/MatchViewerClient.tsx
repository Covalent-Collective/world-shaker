'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/useT';
import VerifiedHumanBadge from '@/components/world/VerifiedHumanBadge';
import HighlightCard from '@/components/match/HighlightCard';
import TranscriptToggle from '@/components/match/TranscriptToggle';
import { SafetyMenu } from '@/components/safety/SafetyMenu';

interface HighlightQuote {
  speaker: string;
  text: string;
}

interface TranscriptLine {
  speaker: string;
  text: string;
}

interface MatchRow {
  id: string;
  compatibility_score: number;
  why_click: string;
  watch_out: string;
  highlight_quotes: HighlightQuote[];
  rendered_transcript: TranscriptLine[];
}

interface MatchViewerClientProps {
  match: MatchRow;
}

export default function MatchViewerClient({ match }: MatchViewerClientProps): React.ReactElement {
  const t = useT();
  const router = useRouter();
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [loading, setLoading] = useState<'accepted' | 'skipped' | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);

  const handleDecision = async (decision: 'accepted' | 'skipped'): Promise<void> => {
    setLoading(decision);
    try {
      const res = await fetch(`/api/match/${match.id}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });

      if (res.ok) {
        const data = (await res.json()) as { mutual?: boolean };
        if (data.mutual) {
          router.push(`/match/${match.id}/success`);
          return;
        }
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <main className="min-h-dvh p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-xs text-text-2">{t('match.why_click_label')}</p>
          <p className="text-2xl font-semibold text-text">{match.compatibility_score}%</p>
        </div>
        <div className="flex items-center gap-2">
          <VerifiedHumanBadge variant="compact" />
          <button
            type="button"
            aria-label={t('safety.report')}
            onClick={() => setSafetyOpen(true)}
            className="rounded-full p-1.5 text-text-3 transition-opacity hover:opacity-70 active:opacity-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </button>
        </div>
      </div>
      <SafetyMenu
        surfaceContext={{ match_id: match.id }}
        open={safetyOpen}
        onOpenChange={setSafetyOpen}
      />

      {showFullTranscript ? (
        <TranscriptToggle
          transcript={match.rendered_transcript}
          onBack={() => setShowFullTranscript(false)}
        />
      ) : (
        <>
          <HighlightCard
            whyClick={match.why_click}
            watchOut={match.watch_out}
            highlightQuotes={match.highlight_quotes}
            whyClickLabel={t('match.why_click_label')}
            watchOutLabel={t('match.watch_out_label')}
          />
          <button
            type="button"
            onClick={() => setShowFullTranscript(true)}
            className="w-full rounded-xl border border-text-4/15 bg-bg-1 py-3 px-6 text-sm font-medium text-text transition-opacity hover:opacity-80 active:opacity-60"
          >
            {t('match.toggle_full')}
          </button>
        </>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => handleDecision('skipped')}
          disabled={loading !== null}
          className="flex-1 rounded-xl border border-text-4/15 bg-bg-1 py-3 px-6 text-sm font-medium text-text transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-40"
        >
          {t('match.skip')}
        </button>
        <button
          type="button"
          onClick={() => handleDecision('accepted')}
          disabled={loading !== null}
          className="flex-1 rounded-xl bg-foreground py-3 px-6 text-sm font-semibold text-background transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-40"
        >
          {t('match.like')}
        </button>
      </div>
    </main>
  );
}
