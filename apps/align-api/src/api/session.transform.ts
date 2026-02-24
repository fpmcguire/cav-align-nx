/**
 * session.transform.ts
 *
 * Transform database session records (snake_case) to API format (camelCase).
 * Implements Sessions API Contract v1.0 field naming requirements.
 */

// Database session (snake_case from Supabase)
export interface DbSession {
  id: string;
  tenant_id: string;
  connection_id: string;
  protocol: string;
  status: 'starting' | 'active' | 'stopped' | 'error';
  health: 'healthy' | 'degraded' | 'stalled';
  message_count: number;
  started_at: string;
  stopped_at: string | null;
}

// API session (camelCase per contract)
export interface ApiSession {
  id: string;
  connectionId: string;
  protocol: string;
  status: 'starting' | 'active' | 'stopped' | 'error';
  health: 'healthy' | 'degraded' | 'stalled';
  messageCount: number;
  startedAt: string;
  stoppedAt: string | null;
}

/**
 * Transform database session to API format.
 * Converts snake_case fields to camelCase per Sessions API Contract v1.0.
 */
export function transformSessionToApi(dbSession: DbSession): ApiSession {
  return {
    id: dbSession.id,
    connectionId: dbSession.connection_id,
    protocol: dbSession.protocol,
    status: dbSession.status,
    health: dbSession.health,
    messageCount: dbSession.message_count,
    startedAt: dbSession.started_at,
    stoppedAt: dbSession.stopped_at,
  };
}

/**
 * Transform array of database sessions to API format.
 */
export function transformSessionsToApi(dbSessions: DbSession[]): ApiSession[] {
  return dbSessions.map(transformSessionToApi);
}
