/**
 * ot-config.ts
 *
 * Configuration for Observed Truth inference and Divergence detection.
 *
 * This is where "sustained" is defined operationally. Rather than asking
 * users to set rules, Align uses sensible defaults with per-connection
 * overrides. The goal is to make the system self-configuring — the user
 * points Align at a broker and observes, not governs.
 *
 * All thresholds are advisory defaults. They can be overridden at the
 * connection or topic level.
 */

/**
 * Configuration for how Align infers Observed Truth from observed messages.
 */
export interface OtInferenceConfig {
  /**
   * Minimum number of messages required before OT inference begins.
   * Below this count, a topic remains in 'discovering' status.
   * Default: 30
   */
  readonly minSampleSize: number;

  /**
   * Minimum clock time (ms) that must pass before OT can be established,
   * regardless of message count. Prevents OT from being inferred from a
   * burst of messages in a single second.
   * Default: 60_000 (1 minute)
   */
  readonly minObservationWindowMs: number;

  /**
   * Fraction of messages in which a field must be present for it to be
   * classified as 'required' in the Shape OT.
   * Default: 0.95
   */
  readonly shapeRequiredPresenceThreshold: number;

  /**
   * Maximum nesting depth for Shape inference.
   * Fields deeper than this are recorded as opaque 'object' or 'array'.
   * Default: 3
   */
  readonly shapeMaxDepth: number;

  /**
   * Maximum number of distinct string values to track for categorical
   * Domain fields. Above this, the field is marked isOpenSet: true.
   * Default: 50
   */
  readonly domainCategoricalCardinalityLimit: number;
}

/**
 * Configuration for how Align detects and confirms Divergence.
 */
export interface DivergenceDetectionConfig {
  /**
   * Number of consecutive messages that must exhibit a deviation
   * before the divergence transitions from 'accumulating' to 'confirmed'.
   * Default: 5
   */
  readonly confirmationMessageCount: number;

  /**
   * Clock time (ms) over which the confirmation messages must occur.
   * Prevents confirmation from a single rapid burst.
   * Default: 30_000 (30 seconds)
   */
  readonly confirmationWindowMs: number;

  /**
   * Multiplier on OT cadence stdDev to determine the stale threshold.
   * A topic is 'stale' when no message is received within:
   *   meanIntervalMs + (stdDevMultiplierForStale * stdDevIntervalMs)
   * Default: 3.0
   */
  readonly cadenceStaleStdDevMultiplier: number;

  /**
   * Multiplier on OT numeric field stdDev to define the out-of-range band.
   * A value is a Domain divergence candidate when it falls outside:
   *   mean ± (domainOutOfRangeStdDevMultiplier * stdDev)
   * Default: 3.0
   */
  readonly domainOutOfRangeStdDevMultiplier: number;

  /**
   * How long (ms) a divergence must be absent before it is marked 'resolved'.
   * Default: 60_000 (1 minute)
   */
  readonly resolutionWindowMs: number;
}

/**
 * The full OT and divergence configuration for a connection or topic.
 * Stored alongside the BrokerConnection in Supabase.
 */
export interface AlignConfig {
  readonly inference: OtInferenceConfig;
  readonly detection: DivergenceDetectionConfig;
}

/**
 * The system defaults — used when no override is configured.
 * Exported as a constant so both API and frontend can reference
 * the same baseline without a network call.
 */
export const DEFAULT_ALIGN_CONFIG: AlignConfig = {
  inference: {
    minSampleSize: 30,
    minObservationWindowMs: 60_000,
    shapeRequiredPresenceThreshold: 0.95,
    shapeMaxDepth: 3,
    domainCategoricalCardinalityLimit: 50,
  },
  detection: {
    confirmationMessageCount: 5,
    confirmationWindowMs: 30_000,
    cadenceStaleStdDevMultiplier: 3.0,
    domainOutOfRangeStdDevMultiplier: 3.0,
    resolutionWindowMs: 60_000,
  },
};
