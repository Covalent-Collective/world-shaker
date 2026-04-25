import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@/lib': path.resolve(__dirname, './lib'),
      '@/types': path.resolve(__dirname, './types'),
      // server-only is a Next.js guard that throws at runtime in non-server
      // contexts. Stub it out in the test environment so server modules can
      // be imported and unit-tested without a full Next.js server.
      'server-only': path.resolve(__dirname, './__mocks__/server-only.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'supabase/.branches'],
  },
});
