'use client';

import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/useT';

interface VerifiedHumanBadgeProps {
  variant?: 'compact' | 'full';
  className?: string;
}

export default function VerifiedHumanBadge({
  variant = 'full',
  className,
}: VerifiedHumanBadgeProps): React.ReactElement {
  const t = useT();
  const label = t('badge.verified_human');

  if (variant === 'compact') {
    return (
      <span
        className={cn('inline-flex items-center text-muted-foreground', className)}
        aria-label="World ID Verified Human"
      >
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}
      aria-label="World ID Verified Human"
    >
      <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
