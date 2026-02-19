/**
 * auth.middleware.ts
 *
 * CAV Level 1 hardening — Section 3 of Hardening Directive.
 *
 * Responsibilities:
 *   1. Honour existing requestId if already set by app.ts base middleware.
 *   2. Validate Bearer JWT via Supabase user-scoped client.
 *   3. Resolve tenantId from tenant_users table.
 *   4. Attach TenantContext to req.tenantContext.
 *   5. Attach per-request child logger to req.log.
 *
 * Production gate:
 *   If NODE_ENV=production OR REQUIRE_AUTH=true, offline bypass is disabled.
 *   Requests without Supabase configured will receive 503 in production.
 *
 * Tenant is NEVER inferred from request body — always from JWT.
 */

import type { Request, Response, NextFunction } from 'express';
import { buildUserClient } from '../lib/supabase-client';
import { rootLogger } from '../lib/logger';
import type { TenantContext, ModuleLimits, ModuleUsage } from '@cav-align/core';

function isProductionMode(): boolean {
  return process.env['NODE_ENV'] === 'production' || process.env['REQUIRE_AUTH'] === 'true';
}

export async function tenantAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Honour requestId already set by app.ts — do not regenerate
  if (!req.requestId) {
    const { randomUUID } = await import('crypto');
    req.requestId = randomUUID();
    req.log       = rootLogger.child({ requestId: req.requestId });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token    = authHeader.replace('Bearer ', '').trim();
  const supabase = buildUserClient(token);

  if (!supabase) {
    if (isProductionMode()) {
      req.log.error('Auth bypassed in production — Supabase not configured');
      res.status(503).json({ error: 'Authentication service not available' });
      return;
    }
    // Offline/dev mode only — warn and pass through
    req.log.warn('Supabase not configured — skipping auth (dev/offline mode only)');
    next();
    return;
  }

  // Validate JWT
  const { data: { user }, error: userError } = await supabase.auth.getUser();
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

  const tenantRow = (tenantUserRow['tenants'] as unknown) as Record<string, unknown> | null;

  // Resolve module subscriptions
  const { data: subs } = await supabase
    .from('module_subscriptions')
    .select('*')
    .eq('tenant_id', tenantUserRow.tenant_id)
    .in('status', ['active', 'trial']);

  const context: TenantContext = {
    user,
    tenant: {
      id:               tenantUserRow.tenant_id,
      organizationName: (tenantRow?.['organization_name'] as string) ?? '',
      createdAt:        (tenantRow?.['created_at'] as string) ?? '',
    },
    subscriptions: (subs ?? []).map((s: Record<string, unknown>) => ({
      id:           s['id'] as string,
      tenantId:     s['tenant_id'] as string,
      moduleName:   s['module_name'] as string,
      status:       s['status'] as 'active' | 'trial' | 'suspended' | 'canceled',
      tier:         s['tier'] as 'starter' | 'professional' | 'enterprise' | 'custom',
      limits:       (s['limits'] as ModuleLimits) ?? ({} as ModuleLimits),
      usage:        (s['usage'] as ModuleUsage) ?? ({} as ModuleUsage),
      startedAt:    s['started_at'] as string,
      expiresAt:    s['expires_at'] as string | undefined,
      trialEndsAt:  s['trial_ends_at'] as string | undefined,
      usageResetAt: s['usage_reset_at'] as string,
    })),
  };

  req.tenantContext = context;

  // Rebind logger with tenant + user — same requestId, no new UUID
  req.log = rootLogger.child({
    requestId: req.requestId,
    tenantId:  context.tenant.id,
    userId:    user.id,
  });

  req.log.debug('Request authenticated', { method: req.method, path: req.path });
  next();
}
