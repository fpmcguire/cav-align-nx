/**
 * source.ts
 *
 * A Source is the protocol-agnostic unit of observation in CAV-Align.
 * Sources are discovered passively by observing protocol traffic.
 *
 * What is a "source"?
 *   - MQTT: a topic path (e.g., 'vda5050/KUKA/V01/state')
 *   - HTTP: an endpoint + method (e.g., 'GET /api/devices/123/telemetry')
 *   - Kafka: a topic name (e.g., 'device-telemetry')
 *
 * This replaces the MQTT-specific "Topic" concept from v0.
 */

/**
 * The lifecycle of a source within an alignment session.
 *
 * - 'discovering'  : Messages observed, insufficient sample for OT inference.
 * - 'observing'    : Sufficient sample reached; OT inference in progress.
 * - 'established'  : Observed Truth has been inferred and is active.
 * - 'diverged'     : One or more OT dimensions show confirmed Divergence.
 * - 'stale'        : No messages received within the expected cadence window.
 * - 'silent'       : Source has been silent long enough to be considered inactive.
 */
export type SourceLifecycleStatus =
  | 'discovering'
  | 'observing'
  | 'established'
  | 'diverged'
  | 'stale'
  | 'silent';

/**
 * A discovered data source being observed by CAV-Align.
 *
 * The sourceIdentifier is protocol-specific and stored as a hash at rest.
 * The readable identifier is resolved at the display layer for authorized users.
 */
export interface Source {
  readonly id: string;                      // UUID
  readonly connectionId: string;            // Parent ProtocolConnection
  readonly sessionId: string;               // Parent AlignmentSession
  readonly protocol: 'mqtt' | 'http' | 'kafka';
  readonly sourceIdentifierHash: string;    // SHA-256 of full source identifier (stored at rest)
  readonly sourceIdentifier: string;        // Readable identifier — resolved at display layer only
  readonly status: SourceLifecycleStatus;
  readonly firstSeenAt: string;             // ISO 8601
  readonly lastMessageAt: string;           // ISO 8601
  readonly messageCount: number;            // Total messages observed in this session
  readonly observedTruthId?: string;        // Set once OT is established
}

/**
 * Lightweight summary used in source list views.
 * Does not include OT or divergence detail.
 */
export interface SourceSummary {
  readonly id: string;
  readonly protocol: 'mqtt' | 'http' | 'kafka';
  readonly sourceIdentifier: string;
  readonly status: SourceLifecycleStatus;
  readonly lastMessageAt: string;
  readonly messageCount: number;
  readonly hasDivergence: boolean;
}
