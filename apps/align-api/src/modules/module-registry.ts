/**
 * module-registry.ts
 *
 * Central registry for protocol adapters (modules).
 * Manages:
 *   - Adapter registration by protocol type
 *   - Adapter instantiation
 *   - Adapter lifecycle (connect/disconnect)
 *   - Tenant module subscription validation
 *
 * This is the integration point where protocol modules (MQTT, HTTP, Kafka)
 * register with the CAV-Align shell.
 */

import type {
  ProtocolAdapter,
  ProtocolAdapterFactory,
  ProtocolConnection,
} from '@cav-align/core';

/**
 * Module registry manages all available protocol adapters.
 */
export class ModuleRegistry {
  private readonly factories = new Map<string, ProtocolAdapterFactory>();
  private readonly activeAdapters = new Map<string, ProtocolAdapter>();

  /**
   * Register a protocol adapter factory.
   * Called during server startup to register available modules.
   *
   * Example:
   *   registry.register('mqtt', () => new MqttProtocolAdapter());
   */
  register(protocol: string, factory: ProtocolAdapterFactory): void {
    if (this.factories.has(protocol)) {
      throw new Error(`Protocol adapter for '${protocol}' is already registered`);
    }
    this.factories.set(protocol, factory);
    console.log(`[ModuleRegistry] Registered adapter for protocol: ${protocol}`);
  }

  /**
   * Check if a protocol adapter is available.
   */
  hasAdapter(protocol: string): boolean {
    return this.factories.has(protocol);
  }

  /**
   * Get or create a protocol adapter for a connection.
   * Returns the same adapter instance if already active for this connection.
   */
  getOrCreateAdapter(connection: ProtocolConnection): ProtocolAdapter {
    const existingAdapter = this.activeAdapters.get(connection.id);
    if (existingAdapter) {
      return existingAdapter;
    }

    const factory = this.factories.get(connection.protocol);
    if (!factory) {
      throw new Error(
        `No adapter registered for protocol: ${connection.protocol}. ` +
        `Available protocols: ${Array.from(this.factories.keys()).join(', ')}`
      );
    }

    const adapter = factory();
    this.activeAdapters.set(connection.id, adapter);
    console.log(`[ModuleRegistry] Created adapter for connection ${connection.id} (${connection.protocol})`);
    
    return adapter;
  }

  /**
   * Disconnect and remove an adapter.
   */
  async disconnectAdapter(connectionId: string): Promise<void> {
    const adapter = this.activeAdapters.get(connectionId);
    if (!adapter) return;

    await adapter.disconnect();
    this.activeAdapters.delete(connectionId);
    console.log(`[ModuleRegistry] Disconnected adapter for connection ${connectionId}`);
  }

  /**
   * Get all active connection IDs.
   */
  getActiveConnectionIds(): string[] {
    return Array.from(this.activeAdapters.keys());
  }

  /**
   * Get all registered protocol types.
   */
  getRegisteredProtocols(): string[] {
    return Array.from(this.factories.keys());
  }
}
