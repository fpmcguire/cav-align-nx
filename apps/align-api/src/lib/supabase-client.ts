/**
 * supabase-client.ts
 *
 * Backend Supabase client using the service role key.
 * This bypasses RLS for server-side engine persistence.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | undefined {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    // Supabase not configured — engines run in offline/in-memory mode
    return undefined;
  }

  if (!_client) {
    _client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return _client;
}
