/**
 * normalized-message.ts
 *
 * The protocol-agnostic message format consumed by the CAV-Align shell.
 * All protocol adapters normalize their native message format into this structure
 * before emitting to the ingestion pipeline.
 *
 * This is the contract between protocol modules and the shell's Observed Truth engine.
 */

/**
 * A normalized message from any protocol source.
 * This is what the shell's ingestion pipeline processes.
 */
export interface NormalizedMessage {
  /** Tenant this message belongs to. */
  readonly tenantId: string;

  /** Which protocol connection produced this message. */
  readonly connectionId: string;

  /**
   * Protocol-specific source identifier.
   * - MQTT: topic path (e.g., 'vda5050/KUKA/V01/state')
   * - HTTP: endpoint + method (e.g., 'GET /api/devices/123/telemetry')
   * - Kafka: topic name (e.g., 'device-telemetry')
   */
  readonly sourceId: string;

  /** Message arrival timestamp (ISO 8601). */
  readonly timestamp: string;

  /**
   * Parsed message payload.
   * v1: JSON objects only.
   * Future: binary, Protobuf, Avro, etc.
   */
  readonly payload: unknown;

  /** Protocol-specific metadata. */
  readonly metadata: MessageMetadata;

  /**
   * Optional identity extraction hints provided by the protocol adapter.
   * The shell's identity segmentation layer uses these plus tenant configuration
   * to slice divergence by entity (device, user, etc.).
   */
  readonly identityHints?: IdentityHints;
}

/**
 * Protocol-specific metadata carried with each message.
 * The base fields are common; additional fields can be added per protocol.
 */
export interface MessageMetadata {
  /** Which protocol this message came from. */
  readonly protocol: 'mqtt' | 'http' | 'kafka';

  /** Protocol version (e.g., MQTT 3.1.1, HTTP/2). */
  readonly protocolVersion?: string;

  /** Protocol-specific fields (e.g., MQTT QoS, HTTP status code). */
  readonly [key: string]: unknown;
}

/**
 * MQTT-specific metadata.
 */
export interface MqttMessageMetadata extends MessageMetadata {
  readonly protocol: 'mqtt';
  readonly qos: 0 | 1 | 2;
  readonly retain: boolean;
  readonly dup: boolean;
}

/**
 * HTTP-specific metadata.
 */
export interface HttpMessageMetadata extends MessageMetadata {
  readonly protocol: 'http';
  readonly method: string;
  readonly statusCode: number;
  readonly headers: Record<string, string>;
}

/**
 * Kafka-specific metadata.
 */
export interface KafkaMessageMetadata extends MessageMetadata {
  readonly protocol: 'kafka';
  readonly partition: number;
  readonly offset: number;
  readonly key?: string;
}

/**
 * Optional identity extraction hints provided by protocol adapters.
 * These are advisory — the shell's identity segmentation layer may override
 * based on tenant configuration.
 */
export interface IdentityHints {
  /** Device/equipment identifier (e.g., extracted from MQTT topic). */
  readonly deviceId?: string;

  /** User identifier (e.g., from HTTP auth header). */
  readonly userId?: string;

  /** Entity type classifier (e.g., 'agv', 'sensor', 'user'). */
  readonly entityType?: string;

  /** Custom identity fields (protocol-specific). */
  readonly [key: string]: unknown;
}
