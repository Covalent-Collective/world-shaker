import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Sensible defaults for tests that import server-only modules.
process.env.SUPABASE_JWT_SECRET ??= 'test_jwt_secret_minimum_32_bytes_long_for_hs256';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test_anon_key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test_service_role_key';

vi.mock('server-only', () => ({}));
