/**
 * express.d.ts
 *
 * Extends Express Request with TenantContext and per-request logger.
 * Set by auth.middleware.ts on every authenticated request.
 */

import type { TenantContext } from '@cav-align/core';
import type { Logger } from '../lib/logger';

declare global {
  namespace Express {
    interface Request {
      tenantContext: TenantContext;
      requestId: string;
      log: Logger;
    }
  }
}
