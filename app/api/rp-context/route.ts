import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateRpContext } from '@/lib/world/verify';

export const runtime = 'edge';

const Body = z.object({
  signal: z.string().optional(),
});

/**
 * POST /api/rp-context
 *
 * Server-side endpoint that signs an RP context using WORLD_SIGNING_KEY.
 * The client calls this BEFORE opening the IDKit widget, then passes the
 * returned context to IDKit. This is the only place WORLD_SIGNING_KEY
 * is ever used — it must never reach the browser.
 */
export async function POST(req: Request) {
  try {
    const body = Body.safeParse(await req.json().catch(() => ({})));
    if (!body.success) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const ctx = await generateRpContext({ signal: body.data.signal });
    return NextResponse.json(ctx);
  } catch (err) {
    console.error('rp-context error:', err);
    return NextResponse.json({ error: 'rp_context_failed' }, { status: 500 });
  }
}
