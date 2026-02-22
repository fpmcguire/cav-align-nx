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
 *
 * Schema corrections (vs Prismatic-era middleware):
 *   - tenants.name          (not organization_name)
 *   - module_subscriptions.module  (not module_name)
 *   - module_subscriptions.active: boolean  (not status: text)
 * 
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
  next: NextFunction
): Promise<void> {
  // Honour requestId already set by app.ts — do not regenerate
  if (!req.requestId) {
    const { randomUUID } = await import('crypto');
    req.requestId = randomUUID();
    req.log = rootLogger.child({ requestId: req.requestId });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.replace('Bearer ', '').trim();
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
  // tenants.name — not organization_name (Prismatic-era column no longer exists)
  const { data: tenantUserRow, error: tenantError } = await supabase
    .from('tenant_users')
    .select('tenant_id, tenants(id, name, created_at)')
    .eq('user_id', user.id)
    .single();

  if (tenantError || !tenantUserRow) {
    req.log.warn('No tenant associated with user', { userId: user.id });
    res.status(403).json({ error: 'No tenant associated with this account' });
    return;
  }

  const tenantRow = tenantUserRow['tenants'] as unknown as Record<string, unknown> | null;

  // Resolve module subscriptions
  // Schema uses active: boolean — not status: text (Prismatic-era column)
  const { data: subs } = await supabase
    .from('module_subscriptions')
    .select('*')
    .eq('tenant_id', tenantUserRow.tenant_id)
    .eq('active', true);

  const context: TenantContext = {
    user,
    tenant: {
      id: tenantUserRow.tenant_id,
      organizationName: (tenantRow?.['name'] as string) ?? '', // tenants.name
      createdAt: (tenantRow?.['created_at'] as string) ?? '',
    },
    subscriptions: (subs ?? []).map((s: Record<string, unknown>) => ({
      id: s['id'] as string,
      tenantId: s['tenant_id'] as string,
      moduleName: s['module'] as string, // module_subscriptions.module
      status: s['active'] ? 'active' : 'suspended', // derived from boolean
      tier: 'starter' as const, // not stored — default
      limits: {} as ModuleLimits,
      usage: {} as ModuleUsage,
      startedAt: s['created_at'] as string,
      expiresAt: undefined,
      trialEndsAt: undefined,
      usageResetAt: s['created_at'] as string,
    })),
  };

  req.tenantContext = context;

  // Rebind logger with tenant + user — same requestId, no new UUID
  req.log = rootLogger.child({
    requestId: req.requestId,
    tenantId: context.tenant.id,
    userId: user.id,
  });

  req.log.debug('Request authenticated', { method: req.method, path: req.path });
  next();
}
