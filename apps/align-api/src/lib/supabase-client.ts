/**
 * supabase-client.ts
 *
 * Single source of truth for ALL Supabase client construction.
 * No other file in align-api should import createClient directly.
 *
 * Two client types:
 *
 *   getSupabaseClient()    — service-role client (bypasses RLS).
 *                            Used by stores for engine-side persistence.
 *                            Requires SUPABASE_SERVICE_ROLE_KEY.
 *
 *   buildUserClient(token) — user-scoped client (respects RLS).
 *                            Used by routes/stores for user-facing queries.
 *                            Requires SUPABASE_ANON_KEY + valid JWT.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (engine/store operations)
 *   SUPABASE_ANON_KEY          (user-scoped operations)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Service-role client (singleton — bypasses RLS)
// ---------------------------------------------------------------------------

let _serviceClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | undefined {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    return undefined;
  }

  if (!_serviceClient) {
    _serviceClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return _serviceClient;
}

// ---------------------------------------------------------------------------
// User-scoped client (per-request — respects RLS)
// ---------------------------------------------------------------------------

/**
 * Builds a Supabase client scoped to the authenticated user's JWT.
 * RLS policies are enforced — tenant isolation guaranteed by DB layer.
 *
 * Returns null if Supabase is not configured (offline mode).
 */
export function buildUserClient(token: string): SupabaseClient | null {
  const url  = process.env['SUPABASE_URL'];
  const anon = process.env['SUPABASE_ANON_KEY'];

  if (!url || !anon) return null;

  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
