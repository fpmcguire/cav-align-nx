/**
 * tenant.store.ts
 *
 * CAV Level 1 hardening — Store layer.
 *
 * Sole DB layer for the tenants table (service-role reads only).
 * Exists to prevent direct Supabase calls in app.ts for the
 * expiration checker loop.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rootLogger } from '../lib/logger';

export class TenantStore {
  private readonly log = rootLogger.child({ context: 'TenantStore' });

  constructor(private readonly supabase: SupabaseClient) {}

  async listTenantIds(): Promise<string[]> {
    try {
      const { data, error } = await this.supabase
        .from('tenants')
        .select('id');

      if (error) {
        this.log.error('listTenantIds failed', error);
        return [];
      }

      return (data ?? []).map((row: Record<string, unknown>) => row['id'] as string);
    } catch (err) {
      this.log.error('listTenantIds exception', err);
      return [];
    }
  }
}
