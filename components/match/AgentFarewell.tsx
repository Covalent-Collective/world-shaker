'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface AgentFarewellProps {
  className?: string;
}

export default function AgentFarewell({ className }: AgentFarewellProps): React.ReactElement {
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
        'text-center space-y-2 transition-all duration-400 ease-out',
        mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
        className,
      )}
    >
      <p className="font-serif text-2xl leading-snug text-text">서로가 연결됐어요</p>
      <p className="text-sm text-text-2">에이전트가 두 분을 이어줬어요. 이제 직접 만나보세요.</p>
    </div>
  );
}
