/**
 * api.ts
 *
 * Request and response types for the Align REST API.
 * These are the DTOs that cross the HTTP boundary between
 * the Angular frontend and the Node/Express backend.
 *
 * Naming convention: <Resource><Action>Request / <Resource><Action>Response
 */

import type { BrokerConnection, BrokerConnectionState } from './broker';
import type { AlignmentSession, SessionStats } from './session';
import type { Topic } from './topic';
import type { ObservedTruth } from './observed-truth';
import type { DivergenceEvent } from './divergence';
import type { AlignConfig } from './ot-config';

// ---------------------------------------------------------------------------
// Broker Connections
// ---------------------------------------------------------------------------

export interface CreateBrokerConnectionRequest {
  readonly name: string;
  readonly protocol: 'mqtt';
  readonly host: string;
  readonly port: number;
  readonly useTls: boolean;
  readonly clientIdPrefix?: string;
  readonly username?: string;
  readonly password?: string;
  readonly config?: Partial<AlignConfig>;
}

export interface UpdateBrokerConnectionRequest {
  readonly name?: string;
  readonly host?: string;
  readonly port?: number;
  readonly useTls?: boolean;
  readonly username?: string;
  readonly password?: string;           // Omit to leave unchanged
  readonly config?: Partial<AlignConfig>;
}

export interface BrokerConnectionResponse {
  readonly connection: BrokerConnection;
  readonly state: BrokerConnectionState;
}

export interface BrokerConnectionListResponse {
  readonly connections: BrokerConnectionResponse[];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface StartSessionRequest {
  readonly connectionId: string;
  readonly name?: string;
  readonly topicFilters: string[];      // e.g. ['#'] or ['vda5050/+/+/state']
}

export interface StopSessionRequest {
  readonly sessionId: string;
}

export interface SessionResponse {
  readonly session: AlignmentSession;
  readonly stats: SessionStats;
}

export interface SessionListResponse {
  readonly sessions: AlignmentSession[];
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export interface TopicListResponse {
  readonly sessionId: string;
  readonly topics: Topic[];
}

export interface TopicDetailResponse {
  readonly topic: Topic;
  readonly observedTruth?: ObservedTruth;
  readonly activeDivergences: DivergenceEvent[];
}

// ---------------------------------------------------------------------------
// Divergence Events
// ---------------------------------------------------------------------------

export interface DivergenceEventListResponse {
  readonly sessionId: string;
  readonly events: DivergenceEvent[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

/**
 * Standard error envelope returned by the API on 4xx/5xx responses.
 */
export interface ApiError {
  readonly code: string;                // Machine-readable error code
  readonly message: string;             // Human-readable description
  readonly details?: Record<string, unknown>;
}

/**
 * Paginated list wrapper for large result sets.
 */
export interface PaginatedResponse<T> {
  readonly items: T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}
