'use client';

import { MessageCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StarterCardProps {
  text: string;
  worldChatLink: string;
  className?: string;
}

export default function StarterCard({
  text,
  worldChatLink,
  className,
}: StarterCardProps): React.ReactElement {
  const handleClick = (): void => {
    window.open(worldChatLink, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn('w-full text-left', className)}
      data-testid="starter-card"
    >
      <Card className="transition-all duration-150 hover:border-text-4/30 hover:bg-bg-1/80 active:scale-[0.98] active:opacity-80">
        <CardContent className="flex items-start gap-3 pt-1">
          <MessageCircle className="h-4 w-4 mt-0.5 shrink-0 text-text-2" aria-hidden="true" />
          <p className="text-sm text-text leading-relaxed">{text}</p>
        </CardContent>
      </Card>
    </button>
  );
}
