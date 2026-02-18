/**
 * mqtt-message-normalizer.ts
 *
 * Converts MQTT-native messages into the protocol-agnostic NormalizedMessage format
 * consumed by the CAV-Align shell's ingestion pipeline.
 *
 * Responsibilities:
 *   - Parse MQTT payload (JSON for v1)
 *   - Extract MQTT-specific metadata (QoS, retain, dup)
 *   - Attach identity hints (deviceId from topic path)
 */

import type {
  NormalizedMessage,
  MqttMessageMetadata,
  IdentityHints,
} from '@cav-align/core';

export interface MqttRawMessage {
  readonly topic: string;
  readonly payload: Uint8Array;
  readonly qos: 0 | 1 | 2;
  readonly retain: boolean;
  readonly dup: boolean;
}

export interface MqttNormalizerConfig {
  readonly tenantId: string;
  readonly connectionId: string;
  readonly identityExtractor?: (topic: string, payload: unknown) => IdentityHints;
}

/**
 * Normalizes an MQTT message into the shell's universal format.
 */
export function normalizeMqttMessage(
  raw: MqttRawMessage,
  config: MqttNormalizerConfig
): NormalizedMessage | null {
  // Decode payload
  const payloadText = new TextDecoder().decode(raw.payload);

  // Parse JSON (v1: JSON-only)
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch (err) {
    // Non-JSON payload — skip for v1
    console.warn(`Non-JSON payload on topic ${raw.topic}`, err);
    return null;
  }

  // Extract identity hints
  const identityHints = config.identityExtractor
    ? config.identityExtractor(raw.topic, payload)
    : extractDefaultIdentity(raw.topic);

  // Build metadata
  const metadata: MqttMessageMetadata = {
    protocol: 'mqtt',
    protocolVersion: '3.1.1', // Assume MQTT 3.1.1 for now
    qos: raw.qos,
    retain: raw.retain,
    dup: raw.dup,
  };

  return {
    tenantId: config.tenantId,
    connectionId: config.connectionId,
    sourceId: raw.topic,
    timestamp: new Date().toISOString(),
    payload,
    metadata,
    identityHints,
  };
}

/**
 * Default identity extraction from MQTT topic path.
 * Looks for common patterns like:
 *   vda5050/{manufacturer}/{serialNumber}/state → deviceId = serialNumber
 *   devices/{deviceId}/telemetry → deviceId
 *   users/{userId}/events → userId
 *
 * Tenant can override this with custom extractors.
 */
function extractDefaultIdentity(topic: string): IdentityHints {
  const segments = topic.split('/');

  // Pattern: devices/{deviceId}/...
  if (segments[0] === 'devices' && segments[1]) {
    return { deviceId: segments[1], entityType: 'device' };
  }

  // Pattern: vda5050/{manufacturer}/{serialNumber}/...
  if (segments[0] === 'vda5050' && segments[2]) {
    return { deviceId: segments[2], entityType: 'agv' };
  }

  // Pattern: users/{userId}/...
  if (segments[0] === 'users' && segments[1]) {
    return { userId: segments[1], entityType: 'user' };
  }

  // No recognizable pattern
  return {};
}
