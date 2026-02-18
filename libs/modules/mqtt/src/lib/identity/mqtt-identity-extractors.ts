/**
 * mqtt-identity-extractors.ts
 *
 * Configurable identity extraction strategies for MQTT topics.
 * Used by the CAV-Align shell's identity segmentation layer to slice
 * divergence events by device, user, or other entities.
 *
 * Tenants can configure which extractor to use per connection or globally.
 */

import type { IdentityHints } from '@cav-align/core';

/**
 * Identity extractor function type.
 * Takes an MQTT topic and parsed payload, returns identity hints.
 */
export type MqttIdentityExtractor = (topic: string, payload: unknown) => IdentityHints;

/**
 * Registry of named identity extractors.
 * Tenants configure which extractor to use via connection settings.
 */
export const MQTT_IDENTITY_EXTRACTORS: Record<string, MqttIdentityExtractor> = {
  /**
   * VDA-5050 AGV topic pattern:
   *   vda5050/{manufacturer}/{serialNumber}/{topic}
   * Extracts serialNumber as deviceId.
   */
  vda5050: (topic: string): IdentityHints => {
    const segments = topic.split('/');
    if (segments[0] === 'vda5050' && segments[2]) {
      return {
        deviceId: segments[2],
        entityType: 'agv',
      };
    }
    return {};
  },

  /**
   * Generic devices pattern:
   *   devices/{deviceId}/{topic}
   * Extracts deviceId from second segment.
   */
  devices: (topic: string): IdentityHints => {
    const segments = topic.split('/');
    if (segments[0] === 'devices' && segments[1]) {
      return {
        deviceId: segments[1],
        entityType: 'device',
      };
    }
    return {};
  },

  /**
   * IoT Core pattern:
   *   iot/{region}/{deviceId}/{topic}
   * Extracts deviceId from third segment.
   */
  iotCore: (topic: string): IdentityHints => {
    const segments = topic.split('/');
    if (segments[0] === 'iot' && segments[2]) {
      return {
        deviceId: segments[2],
        entityType: 'iot-device',
      };
    }
    return {};
  },

  /**
   * User-scoped pattern:
   *   users/{userId}/{topic}
   * Extracts userId from second segment.
   */
  users: (topic: string): IdentityHints => {
    const segments = topic.split('/');
    if (segments[0] === 'users' && segments[1]) {
      return {
        userId: segments[1],
        entityType: 'user',
      };
    }
    return {};
  },

  /**
   * Payload-based extraction:
   * Looks for common device ID fields in the JSON payload.
   */
  payloadDeviceId: (topic: string, payload: unknown): IdentityHints => {
    if (typeof payload !== 'object' || payload === null) {
      return {};
    }

    const obj = payload as Record<string, unknown>;

    // Try common field names
    const deviceId =
      obj.deviceId ??
      obj.device_id ??
      obj.serialNumber ??
      obj.serial_number ??
      obj.equipmentId ??
      obj.equipment_id;

    if (typeof deviceId === 'string') {
      return { deviceId, entityType: 'device' };
    }

    return {};
  },

  /**
   * Combined topic + payload extraction:
   * Tries topic first, falls back to payload.
   */
  auto: (topic: string, payload: unknown): IdentityHints => {
    // Try all topic-based extractors
    for (const extractor of Object.values(MQTT_IDENTITY_EXTRACTORS)) {
      if (extractor === MQTT_IDENTITY_EXTRACTORS.auto) continue;
      if (extractor === MQTT_IDENTITY_EXTRACTORS.payloadDeviceId) continue;

      const hints = extractor(topic, payload);
      if (hints.deviceId || hints.userId) {
        return hints;
      }
    }

    // Fall back to payload extraction
    return MQTT_IDENTITY_EXTRACTORS.payloadDeviceId(topic, payload);
  },

  /**
   * No identity extraction.
   * All messages from this connection are treated as a single source.
   */
  none: (): IdentityHints => ({}),
};

/**
 * Get an identity extractor by name.
 * Returns the 'auto' extractor if the name is not recognized.
 */
export function getMqttIdentityExtractor(name?: string): MqttIdentityExtractor {
  if (!name) return MQTT_IDENTITY_EXTRACTORS.auto;
  return MQTT_IDENTITY_EXTRACTORS[name] ?? MQTT_IDENTITY_EXTRACTORS.auto;
}
