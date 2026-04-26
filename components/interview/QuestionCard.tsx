'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/useT';
import { cn } from '@/lib/utils';

interface QuestionCardProps {
  /** Stable per-question identifier (skeleton question id). */
  questionId: string;
  /** Localized prompt text already resolved by the parent. */
  prompt: string;
  /** Current textarea value. */
  value: string;
  /** Disable inputs during submission. */
  disabled?: boolean;
  /** Disable the submit button (e.g. value is blank). */
  submitDisabled?: boolean;
  /** Submit button label override; falls back to `interview.next`. */
  submitLabel?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/**
 * Single skeleton question card. Owns no state — fully controlled by the
 * parent state machine.
 */
export default function QuestionCard({
  questionId,
  prompt,
  value,
  disabled = false,
  submitDisabled = false,
  submitLabel,
  onChange,
  onSubmit,
}: QuestionCardProps): React.ReactElement {
  const t = useT();
  const placeholder = t('interview.placeholder');
  const fallbackLabel = t('interview.next');
  const textareaId = `question-${questionId}`;

  return (
    <Card data-testid={`question-card-${questionId}`} className="space-y-4">
      <CardHeader>
        <CardTitle>
          <label htmlFor={textareaId}>{prompt}</label>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <textarea
          id={textareaId}
          data-testid={`answer-input-${questionId}`}
          className={cn(
            'min-h-[140px] w-full resize-none rounded-xl border border-text-4/30 bg-bg-2 p-3',
            'text-base text-text placeholder:text-text-3',
            'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40',
            'disabled:opacity-50',
          )}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            data-testid={`answer-submit-${questionId}`}
            onClick={onSubmit}
            disabled={disabled || submitDisabled}
          >
            {submitLabel ?? fallbackLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
