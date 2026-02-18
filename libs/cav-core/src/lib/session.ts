/**
 * session.ts
 *
 * An AlignmentSession is the container for a continuous observation run
 * against a broker connection. Sessions have a defined start time and
 * run until explicitly stopped or the connection is lost.
 *
 * All topics, OT inferences, and divergence events belong to a session.
 * Sessions are the primary unit of historical record in Align.
 */

export type SessionStatus = 'active' | 'stopped' | 'error';

/**
 * An AlignmentSession scoped to a single broker connection.
 */
export interface AlignmentSession {
  readonly id: string;                    // UUID
  readonly connectionId: string;          // Parent BrokerConnection
  readonly organisationId: string;
  readonly name?: string;                 // Optional user-supplied label
  readonly status: SessionStatus;
  readonly startedAt: string;             // ISO 8601
  readonly stoppedAt?: string;            // ISO 8601
  readonly topicCount: number;            // Topics discovered in this session
  readonly divergenceCount: number;       // Confirmed divergence events
  readonly topicFilters: string[];        // MQTT topic filters used for subscription
                                          // e.g. ['#'] or ['vda5050/+/+/state']
}

/**
 * Aggregate statistics for a running or completed session.
 * Pushed to the frontend periodically via WebSocket.
 */
export interface SessionStats {
  readonly sessionId: string;
  readonly topicCount: number;
  readonly establishedTopicCount: number;   // Topics with active OT
  readonly divergedTopicCount: number;      // Topics currently in 'diverged' status
  readonly totalMessageCount: number;
  readonly messagesPerSecond: number;       // Rolling 10s average
  readonly uptimeSeconds: number;
}
