/**
 * initialize-modules.ts
 *
 * Registers all available protocol modules with the module registry.
 * Called during server startup.
 *
 * v1: MQTT only
 * Future: HTTP, Kafka, etc.
 */

import { ModuleRegistry } from './module-registry';
import { MqttProtocolAdapter } from '@cav-align/modules/mqtt';

/**
 * Register all protocol adapters with the module registry.
 */
export function initializeModules(registry: ModuleRegistry): void {
  // Register MQTT adapter (v1)
  registry.register('mqtt', () => new MqttProtocolAdapter());

  // Future:
  // registry.register('http', () => new HttpProtocolAdapter());
  // registry.register('kafka', () => new KafkaProtocolAdapter());

  console.log('[Modules] Initialized protocol adapters');
}
