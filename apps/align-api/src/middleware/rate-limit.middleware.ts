/**
 * rate-limit.middleware.ts
 *
 * Two middleware, two contexts — not one combined middleware.
 *
 *   anonRateLimit   — applied globally in app.ts (before auth)
 *                     keyed by IP, 30 req/60s
 *                     protects login, public endpoints, and auth overhead
 *
 *   tenantRateLimit — applied at router level AFTER tenantAuthMiddleware
 *                     keyed by tenantId (from req.tenantContext)
 *                     300 req/60s per tenant
 *
 * This order ensures authenticated requests always get the higher tenant
 * limit, never the IP-based anonymous limit.
 *
 * CAV Level 1 hardening — Section 4 of Security Checklist.
 */

import type { Request, Response, NextFunction } from 'express';
import { SlidingWindowRateLimiter } from '../lib/rate-limiter';

const anonLimiter   = new SlidingWindowRateLimiter({ maxRequests: 30,  windowMs: 60_000 });
const tenantLimiter = new SlidingWindowRateLimiter({ maxRequests: 300, windowMs: 60_000 });

function sendLimitExceeded(res: Response, resetAfter: number, limit: number): void {
  res.setHeader('Retry-After', String(Math.ceil(resetAfter / 1000)));
  res.setHeader('X-RateLimit-Limit',     String(limit));
  res.setHeader('X-RateLimit-Remaining', '0');
  res.status(429).json({
    error:      'Too many requests',
    retryAfter: Math.ceil(resetAfter / 1000),
  });
}

/**
 * Global anonymous rate limit — keyed by IP.
 * Applied before auth. Exempt: /health, /api.
 */
export function anonRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health' || req.path === '/api') { next(); return; }

  const key    = req.ip ?? 'unknown';
  const result = anonLimiter.check(key);

  res.setHeader('X-RateLimit-Limit',     '30');
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));

  if (!result.allowed) { sendLimitExceeded(res, result.resetAfter, 30); return; }
  next();
}

/**
 * Per-tenant rate limit — keyed by tenantId.
 * Must be applied AFTER tenantAuthMiddleware so req.tenantContext is populated.
 */
export function tenantRateLimit(req: Request, res: Response, next: NextFunction): void {
  const tenantId = req.tenantContext?.tenant?.id;
  if (!tenantId) { next(); return; }   // offline mode — no tenant, skip

  const result = tenantLimiter.check(tenantId);

  res.setHeader('X-RateLimit-Limit',     '300');
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));

  if (!result.allowed) { sendLimitExceeded(res, result.resetAfter, 300); return; }
  next();
}
