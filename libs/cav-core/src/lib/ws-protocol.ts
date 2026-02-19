/**
 * ws-protocol.ts
 *
 * The WebSocket message protocol shared between the Align API (Node)
 * and the Angular frontend. All frames are JSON objects with a `type` discriminant.
 *
 * Client → Server frames: subscription management
 * Server → Client frames: live session events, stats, and status updates
 *
 * The frontend uses `toSignal()` against an Observable<WsServerFrame>
 * to drive reactive UI state.
 */

import type { TopicSummary } from './topic';
import type { DivergenceEventSummary } from './divergence';
import type { SessionStats } from './session';
import type { BrokerConnectionStatus } from './broker';
import type { DivergenceDimension } from './divergence';
import type { BreachSeverity } from './breach';

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export interface WsSubscribeFrame {
  readonly type: 'subscribe';
  readonly sessionId: string;
}

export interface WsUnsubscribeFrame {
  readonly type: 'unsubscribe';
  readonly sessionId: string;
}

export interface WsPingFrame {
  readonly type: 'ping';
}

export type WsClientFrame =
  | WsSubscribeFrame
  | WsUnsubscribeFrame
  | WsPingFrame;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

/** Emitted when a new topic is first discovered on the broker. */
export interface WsTopicDiscoveredFrame {
  readonly type: 'topic:discovered';
  readonly sessionId: string;
  readonly topic: TopicSummary;
}

/** Emitted when a topic's lifecycle status changes (e.g. observing → established). */
export interface WsTopicStatusChangedFrame {
  readonly type: 'topic:status-changed';
  readonly sessionId: string;
  readonly topicId: string;
  readonly status: TopicSummary['status'];
}

/** Emitted when a divergence event transitions to 'accumulating' or 'confirmed'. */
export interface WsDivergenceDetectedFrame {
  readonly type: 'divergence:detected';
  readonly sessionId: string;
  readonly event: DivergenceEventSummary;
}

/** Emitted when a confirmed divergence event resolves. */
export interface WsDivergenceResolvedFrame {
  readonly type: 'divergence:resolved';
  readonly sessionId: string;
  readonly eventId: string;
}

/** Periodic session statistics snapshot (every ~5 seconds). */
export interface WsSessionStatsFrame {
  readonly type: 'session:stats';
  readonly stats: SessionStats;
}

/** Broker connection state change (connect/disconnect/error). */
export interface WsBrokerStatusFrame {
  readonly type: 'broker:status';
  readonly connectionId: string;
  readonly status: BrokerConnectionStatus;
  readonly message?: string;
}

/** Acknowledgement / status response to client frames. */
export interface WsStatusFrame {
  readonly type: 'status';
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface WsPongFrame {
  readonly type: 'pong';
}

export type WsServerFrame =
  | WsTopicDiscoveredFrame
  | WsTopicStatusChangedFrame
  | WsDivergenceDetectedFrame
  | WsDivergenceResolvedFrame
  | WsSessionStatsFrame
  | WsBrokerStatusFrame
  | WsStatusFrame
  | WsPongFrame
  // CAV Level 4 — v2 frames
  | WsBreachDetectedFrame
  | WsBreachResolvedFrame
  | WsIntentUpdatedFrame;

// ---------------------------------------------------------------------------
// CAV Level 4 — Server → Client (v2)
// ---------------------------------------------------------------------------

/**
 * Emitted when an envelope breach is first opened.
 * Includes reason string from delta_detail so the UI can display it
 * without a secondary API call.
 */
export interface WsBreachDetectedFrame {
  readonly type: 'breach:detected';
  readonly tenantId: string;
  readonly breachId: string;
  readonly intentVersionId: string;
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  readonly severity: BreachSeverity;
  readonly deltaValue: number;
  /** Human-readable reason from delta_detail.reason. */
  readonly reason: string;
  readonly breachedAt: string;  // ISO 8601
}

/**
 * Emitted when an active breach is resolved (delta returns within envelope).
 */
export interface WsBreachResolvedFrame {
  readonly type: 'breach:resolved';
  readonly tenantId: string;
  readonly breachId: string;
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  readonly resolvedAt: string;    // ISO 8601
  readonly finalDeltaValue: number;
}

/**
 * Emitted when an intent artifact version is activated.
 * Allows the Angular frontend to refresh intent state reactively.
 */
export interface WsIntentUpdatedFrame {
  readonly type: 'intent:updated';
  readonly tenantId: string;
  readonly artifactId: string;
  readonly topicScope: string;
  readonly dimension: DivergenceDimension;
  readonly newVersionNumber: number;
  readonly effectiveFrom: string;  // ISO 8601
}
