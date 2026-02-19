/**
 * rate-limiter.ts
 *
 * Lightweight per-key sliding window rate limiter.
 * No external dependencies — uses Node's built-in Map + Date.
 *
 * CAV Level 1 hardening — Section 4 (Rate Limiting) of Security Checklist.
 *
 * Used by:
 *   - HTTP rate-limit middleware (keyed by tenantId or IP)
 *   - WebSocket server (keyed by tenantId)
 */

export interface RateLimiterOptions {
  /** Max requests allowed within the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed:    boolean;
  remaining:  number;
  resetAfter: number;   // ms until oldest request expires
}

interface WindowEntry {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: RateLimiterOptions) {
    // Prune expired entries every 5 minutes to prevent unbounded memory growth
    this.cleanupTimer = setInterval(() => this.prune(), 5 * 60_000);
  }

  check(key: string): RateLimitResult {
    const now    = Date.now();
    const cutoff = now - this.opts.windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Evict timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.opts.maxRequests) {
      const oldest     = entry.timestamps[0];
      const resetAfter = oldest + this.opts.windowMs - now;
      return { allowed: false, remaining: 0, resetAfter };
    }

    entry.timestamps.push(now);
    return {
      allowed:    true,
      remaining:  this.opts.maxRequests - entry.timestamps.length,
      resetAfter: 0,
    };
  }

  /** Remove entries that have no timestamps in the current window */
  private prune(): void {
    const cutoff = Date.now() - this.opts.windowMs;
    for (const [key, entry] of this.windows) {
      if (entry.timestamps.every((t) => t <= cutoff)) {
        this.windows.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
