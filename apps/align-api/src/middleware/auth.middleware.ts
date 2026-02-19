/**
 * auth.middleware.ts
 *
 * CAV Level 1 hardening — Section 3 of Hardening Directive.
 *
 * Responsibilities:
 *   1. Generate requestId for every request.
 *   2. Validate Bearer JWT via Supabase anon client.
 *   3. Resolve tenantId from tenant_users table.
 *   4. Attach TenantContext to req.tenantContext.
 *   5. Attach per-request child logger to req.log.
 *
 * Tenant is NEVER inferred from request body — always from JWT.
 */

import type { Request, Response, NextFunction } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import type { TenantContext, ModuleLimits, ModuleUsage } from '@cav-align/core';
import { rootLogger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Build a user-scoped Supabase client from a bearer token
// ---------------------------------------------------------------------------
function buildUserClient(token: string): SupabaseClient | null {
  const url = process.env['SUPABASE_URL'];
  const anon = process.env['SUPABASE_ANON_KEY'];
  if (!url || !anon) return null;

  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export async function tenantAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const requestId = randomUUID();
  req.requestId = requestId;
  req.log = rootLogger.child({ requestId });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.replace('Bearer ', '').trim();

  const supabase = buildUserClient(token);
  if (!supabase) {
    // Supabase not configured — allow request through without tenant context
    // in offline/dev mode. Routes that need a tenant will 501 themselves.
    req.log.warn('Supabase not configured — skipping auth');
    next();
    return;
  }

  // Validate JWT
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    req.log.warn('JWT validation failed', { error: userError?.message });
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Resolve tenant
  const { data: tenantUserRow, error: tenantError } = await supabase
    .from('tenant_users')
    .select('tenant_id, tenants(id, organization_name, created_at)')
    .eq('user_id', user.id)
    .single();

  if (tenantError || !tenantUserRow) {
    req.log.warn('No tenant associated with user', { userId: user.id });
    res.status(403).json({ error: 'No tenant associated with this account' });
    return;
  }

  const tenantRow = tenantUserRow['tenants'] as unknown as Record<string, unknown> | null;

  // Resolve module subscriptions
  const { data: subs } = await supabase
    .from('module_subscriptions')
    .select('*')
    .eq('tenant_id', tenantUserRow.tenant_id)
    .in('status', ['active', 'trial']);

  const context: TenantContext = {
    user,
    tenant: {
      id: tenantUserRow.tenant_id,
      organizationName: (tenantRow?.['organization_name'] as string) ?? '',
      createdAt: (tenantRow?.['created_at'] as string) ?? '',
    },
    subscriptions: (subs ?? []).map((s: Record<string, unknown>) => ({
      id: s['id'] as string,
      tenantId: s['tenant_id'] as string,
      moduleName: s['module_name'] as string,
      status: s['status'] as 'active' | 'trial' | 'suspended' | 'canceled',
      tier: s['tier'] as 'starter' | 'professional' | 'enterprise' | 'custom',
      limits: (s['limits'] as ModuleLimits) ?? ({} as ModuleLimits),
      usage: (s['usage'] as ModuleUsage) ?? ({} as ModuleUsage),
      startedAt: s['started_at'] as string,
      expiresAt: s['expires_at'] as string | undefined,
      trialEndsAt: s['trial_ends_at'] as string | undefined,
      usageResetAt: s['usage_reset_at'] as string,
    })),
  };

  req.tenantContext = context;

  // Rebind logger with tenant + user context
  req.log = rootLogger.child({
    requestId,
    tenantId: context.tenant.id,
    userId: user.id,
  });

  req.log.debug('Request authenticated', { method: req.method, path: req.path });

  next();
}
