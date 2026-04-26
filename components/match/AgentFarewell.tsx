'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/useT';

interface AgentFarewellProps {
  className?: string;
}

export default function AgentFarewell({ className }: AgentFarewellProps): React.ReactElement {
  const t = useT();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger animation on next tick to allow the initial state to render first.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      data-testid="agent-farewell"
      className={cn(
        'text-center space-y-3 transition-all duration-500 ease-out',
        mounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-1',
        className,
      )}
    >
      <p className="font-serif text-3xl leading-tight text-text tracking-tight">
        {t('success.title')}
      </p>
      <p className="text-sm text-text-2 max-w-xs mx-auto leading-relaxed">
        {t('success.subtitle')}
      </p>
    </div>
  );
}
