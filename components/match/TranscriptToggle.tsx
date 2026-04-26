'use client';

import { useT } from '@/lib/i18n/useT';

interface TranscriptLine {
  speaker: string;
  text: string;
}

interface TranscriptToggleProps {
  transcript: TranscriptLine[];
  onBack: () => void;
}

export default function TranscriptToggle({
  transcript,
  onBack,
}: TranscriptToggleProps): React.ReactElement {
  const t = useT();

  const speakers = Array.from(new Set(transcript.map((l) => l.speaker)));
  const speakerLabel = (speaker: string): string => {
    const idx = speakers.indexOf(speaker);
    return idx === 0 ? 'A' : 'B';
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {transcript.map((line, index) => {
          const label = speakerLabel(line.speaker);
          const isA = label === 'A';
          return (
            <div key={index} className={`flex gap-3 ${isA ? 'flex-row' : 'flex-row-reverse'}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-1 border border-text-4/15 text-xs font-semibold text-text-2">
                {label}
              </span>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm text-text ${
                  isA ? 'bg-bg-1 border border-text-4/15' : 'bg-foreground text-background'
                }`}
              >
                {line.text}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="w-full rounded-xl border border-text-4/15 bg-bg-1 py-3 px-6 text-sm font-medium text-text transition-opacity hover:opacity-80 active:opacity-60"
      >
        {t('match.toggle_highlights')}
      </button>
    </div>
  );
}
