'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { MiniKitProvider } from '@worldcoin/minikit-js/minikit-provider';
import { initPostHog } from '@/lib/posthog/client';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    initPostHog();
  }, []);

  const appId = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}`;

  return (
    <MiniKitProvider props={{ appId }}>
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env.NODE_ENV === 'development' ? (
          <ReactQueryDevtools initialIsOpen={false} />
        ) : null}
      </QueryClientProvider>
    </MiniKitProvider>
  );
}
