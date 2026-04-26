'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/useT';
import { cn } from '@/lib/utils';

interface ProbeBubbleProps {
  /** Stable id for testing + form labelling — combines question id + probe index. */
  probeId: string;
  /** Localized probe prompt returned by the LLM. */
  question: string;
  /** Current textarea value. */
  value: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/**
 * Chat-bubble-style follow-up probe rendered inline beneath the parent
 * skeleton question. Owns no state — controlled by InterviewClient.
 */
export default function ProbeBubble({
  probeId,
  question,
  value,
  disabled = false,
  submitDisabled = false,
  submitLabel,
  onChange,
  onSubmit,
}: ProbeBubbleProps): React.ReactElement {
  const t = useT();
  const placeholder = t('interview.placeholder');
  const fallbackLabel = t('interview.next');
  const textareaId = `probe-${probeId}`;

  return (
    <div data-testid={`probe-bubble-${probeId}`} className="space-y-3">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-bg-2 px-4 py-3 text-sm text-text-2">
        {question}
      </div>
      <div className="ml-auto max-w-[90%] space-y-2">
        <label htmlFor={textareaId} className="sr-only">
          {question}
        </label>
        <textarea
          id={textareaId}
          data-testid={`probe-input-${probeId}`}
          className={cn(
            'min-h-[100px] w-full resize-none rounded-xl border border-text-4/30 bg-bg-2 p-3',
            'text-base text-text placeholder:text-text-3',
            'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40',
            'disabled:opacity-50',
          )}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            data-testid={`probe-submit-${probeId}`}
            onClick={onSubmit}
            disabled={disabled || submitDisabled}
          >
            {submitLabel ?? fallbackLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
