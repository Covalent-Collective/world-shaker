'use client';

import { useEffect, useRef } from 'react';
import { MiniKit } from '@worldcoin/minikit-js';

/**
 * WorldProfileCapture — mounts at the providers level and runs a one-shot
 * (per page-load) capture of the current World App user's username and
 * wallet address from MiniKit.user, POSTing them to /api/user/world-profile.
 *
 * The values are stored on the user's active agent so partner-side flows
 * (World Chat handoff in particular) can pre-fill the recipient field
 * with the actual World App username instead of a display name.
 *
 * This component is a no-op outside the World App (MiniKit.isInstalled()
 * returns false) and when the JWT cookie is missing (server returns 401
 * which we silently swallow). It's safe to mount for unauthenticated
 * routes too — the route gates on the cookie itself.
 */
export default function WorldProfileCapture(): null {
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    if (!MiniKit.isInstalled()) return;

    const user = MiniKit.user;
    const username = user?.username?.trim();
    const walletAddress = user?.walletAddress?.trim();
    if (!username && !walletAddress) return;

    sentRef.current = true;

    const body: { username?: string; walletAddress?: string } = {};
    if (username) body.username = username;
    if (walletAddress) body.walletAddress = walletAddress;

    void fetch('/api/user/world-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((err) => {
      // Best-effort capture — failures shouldn't block the rest of the app.
      console.warn('[world-profile-capture] POST failed', err);
    });
  }, []);

  return null;
}
