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
  | WsPongFrame;
