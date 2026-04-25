'use client';

import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      className="font-sans"
      toastOptions={{
        classNames: {
          toast: 'group toast bg-bg-1 text-text border border-text-4/30 rounded-2xl shadow-2xl',
          description: 'text-text-2',
          actionButton: 'bg-accent-deep text-text',
          cancelButton: 'bg-bg-2 text-text-2',
        },
      }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
