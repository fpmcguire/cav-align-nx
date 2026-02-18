/**
 * @cav-align/modules/mqtt
 *
 * MQTT Align module — implements the ProtocolAdapter interface for MQTT brokers.
 *
 * Exports:
 *   - MqttProtocolAdapter: The main adapter implementing ProtocolAdapter
 *   - MqttJsBrowserAdapter: Low-level MQTT client (for direct use if needed)
 *   - Identity extractors: Configurable device/entity extraction from topics
 *   - Topic utilities: Wildcard matching, namespace extraction
 *
 * Import using the path alias:
 *   import { MqttProtocolAdapter, MQTT_IDENTITY_EXTRACTORS } from '@cav-align/modules/mqtt';
 */

// Protocol adapter (NEW - Step 3)
export { MqttProtocolAdapter } from './lib/adapters/protocol/mqtt-protocol.adapter';

// Identity extraction (NEW - Step 3)
export {
  MQTT_IDENTITY_EXTRACTORS,
  getMqttIdentityExtractor,
} from './lib/identity/mqtt-identity-extractors';
export type { MqttIdentityExtractor } from './lib/identity/mqtt-identity-extractors';

// Message normalization (NEW - Step 3)
export { normalizeMqttMessage } from './lib/normalizers/mqtt-message-normalizer';
export type {
  MqttRawMessage,
  MqttNormalizerConfig,
} from './lib/normalizers/mqtt-message-normalizer';

// Low-level MQTT client (existing)
export type { MqttClientPort, MqttConnectionState } from './lib/ports/mqtt-client.port';
export { MqttJsBrowserAdapter } from './lib/adapters/mqttjs-browser.adapter';
export type { MqttBrowserConfig } from './lib/adapters/mqttjs-browser.adapter';

// Topic utilities (existing)
export { topicMatches, isWildcardFilter, topicNamespace } from './lib/topic-utils';

