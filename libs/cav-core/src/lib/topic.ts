/**
 * topic.ts
 *
 * @deprecated This file contains MQTT-specific types that are being replaced
 * by protocol-agnostic types in sources/source.ts
 *
 * Topic → Source
 * TopicLifecycleStatus → SourceLifecycleStatus
 * TopicSummary → SourceSummary
 *
 * These types remain as aliases for backward compatibility during migration.
 * New code should import from sources/source.ts
 */

import type {
  Source,
  SourceLifecycleStatus,
  SourceSummary,
} from './sources/source';

/**
 * @deprecated Use SourceLifecycleStatus from sources/source.ts
 */
export type TopicLifecycleStatus = SourceLifecycleStatus;

/**
 * @deprecated Use Source from sources/source.ts
 * This is an MQTT-specific view of a Source.
 */
export interface Topic {
  readonly id: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly pathHash: string;
  readonly path: string;
  readonly status: TopicLifecycleStatus;
  readonly firstSeenAt: string;
  readonly lastMessageAt: string;
  readonly messageCount: number;
  readonly observedTruthId?: string;
}

/**
 * @deprecated Use SourceSummary from sources/source.ts
 */
export interface TopicSummary {
  readonly id: string;
  readonly path: string;
  readonly status: TopicLifecycleStatus;
  readonly lastMessageAt: string;
  readonly messageCount: number;
  readonly hasDivergence: boolean;
}
