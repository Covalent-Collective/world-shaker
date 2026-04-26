import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface HighlightQuote {
  speaker: string;
  text: string;
}

interface HighlightCardProps {
  whyClick: string;
  watchOut: string;
  highlightQuotes: HighlightQuote[];
  whyClickLabel: string;
  watchOutLabel: string;
}

export default function HighlightCard({
  whyClick,
  watchOut,
  highlightQuotes,
  whyClickLabel,
  watchOutLabel,
}: HighlightCardProps): React.ReactElement {
  const quotes = highlightQuotes.slice(0, 10);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-text-2">
            {whyClickLabel}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text">{whyClick}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-text-2">
            {watchOutLabel}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text">{watchOut}</p>
        </CardContent>
      </Card>

      {quotes.length > 0 && (
        <div className="space-y-2">
          {quotes.map((quote, index) => (
            <blockquote key={index} className="rounded-xl border border-text-4/15 bg-bg-1 p-4">
              <p className="text-sm text-text">&ldquo;{quote.text}&rdquo;</p>
              <footer className="mt-1 text-xs text-text-2">{quote.speaker}</footer>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}
