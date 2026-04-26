'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';

export interface StrollCandidate {
  candidate_user: string;
}

interface CardStackProps {
  candidates: StrollCandidate[];
  onTap: (candidateUserId: string) => void;
}

/**
 * Horizontal scroll-snap card stack for the Daily Stroll surface.
 *
 * v1: Displays the first 8 chars of the candidate UUID as a placeholder
 * label. Avatars and agent profile data will be added in v2 once the
 * agents.avatar_url column is populated by the generation pipeline.
 */
export default function CardStack({ candidates, onTap }: CardStackProps): React.ReactElement {
  return (
    <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4" data-testid="card-stack">
      {candidates.map((candidate) => {
        const shortId = candidate.candidate_user.slice(0, 8);
        return (
          <button
            key={candidate.candidate_user}
            type="button"
            className="w-72 snap-center shrink-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onTap(candidate.candidate_user)}
            data-testid={`candidate-card-${candidate.candidate_user}`}
          >
            <Card className="h-48 cursor-pointer transition-transform active:scale-95 hover:shadow-md">
              <CardContent className="flex h-full flex-col items-center justify-center gap-2 p-6">
                {/* Placeholder avatar circle — v2 will use agents.avatar_url */}
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bg-1 text-lg font-semibold text-text-2 border border-text-4/20">
                  {shortId.slice(0, 2).toUpperCase()}
                </div>
                <p className="text-xs font-mono text-text-3">{shortId}</p>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
