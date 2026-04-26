import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { verifyWorldUserJwt, SESSION_COOKIE } from '@/lib/auth/jwt';
import { getServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

const Body = z.object({
  reported_user_id: z.string().uuid(),
  reason: z.enum(['harassment', 'hateful', 'catfish', 'underage', 'nsfw', 'spam', 'other']),
  detail: z.string().max(500).optional(),
});

/**
 * POST /api/report
 *
 * Submits a user report. Auth via ws_session JWT cookie.
 * Duplicate reports (same reporter + reported pair) return 409.
 */
export async function POST(req: Request) {
  // Auth
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let claims;
  try {
    claims = await verifyWorldUserJwt(token);
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Validate body
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { reported_user_id, reason, detail } = parsed.data;

  const supabase = getServiceClient();
  const { error } = await supabase.from('reports').insert({
    reporter_id: claims.world_user_id,
    reported_user_id,
    reason,
    detail: detail ?? null,
  });

  if (error) {
    // Postgres unique constraint violation — already reported
    if (error.code === '23505') {
      return NextResponse.json({ error: 'already_reported' }, { status: 409 });
    }
    console.error('report insert error:', error);
    return NextResponse.json({ error: 'report_failed' }, { status: 500 });
  }

  return NextResponse.json({ reported: true });
}
