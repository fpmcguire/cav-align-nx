/**
 * rate-limit.middleware.ts
 *
 * Per-tenant HTTP rate limiting using the sliding window rate limiter.
 *
 * Limits:
 *   - Authenticated requests: 300 req / 60s per tenant
 *   - Unauthenticated requests: 30 req / 60s per IP (protects auth endpoints)
 *
 * Applied globally in app.ts before route registration.
 * CAV Level 1 hardening — Section 4 of Security Checklist.
 */

import type { Request, Response, NextFunction } from 'express';
import { SlidingWindowRateLimiter } from '../lib/rate-limiter';

// Two separate limiters — authenticated tenants get higher limits than anonymous IPs
const tenantLimiter = new SlidingWindowRateLimiter({ maxRequests: 300, windowMs: 60_000 });
const anonLimiter   = new SlidingWindowRateLimiter({ maxRequests: 30,  windowMs: 60_000 });

export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Health and API info endpoints are exempt
  if (req.path === '/health' || req.path === '/api') {
    next();
    return;
  }

  // Use tenantId if already attached (middleware order matters — auth runs first for
  // protected routes; for unauthenticated routes we fall back to IP)
  const tenantId = req.tenantContext?.tenant?.id;
  const key      = tenantId ?? (req.ip ?? 'unknown');
  const limiter  = tenantId ? tenantLimiter : anonLimiter;

  const result = limiter.check(key);

  res.setHeader('X-RateLimit-Limit',     tenantId ? '300' : '30');
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));

  if (!result.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(result.resetAfter / 1000)));
    res.status(429).json({
      error:       'Too many requests',
      retryAfter:  Math.ceil(result.resetAfter / 1000),
    });
    return;
  }

  next();
}
