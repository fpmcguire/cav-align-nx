/**
 * protocol-adapter.port.ts
 *
 * The interface every protocol module must implement.
 * This is the contract between protocol modules and the CAV-Align shell.
 *
 * A protocol adapter is responsible for:
 *   1. Connecting to the protocol source (broker, API gateway, etc.)
 *   2. Subscribing to or polling for messages
 *   3. Normalizing messages into the NormalizedMessage format
 *   4. Emitting normalized messages to the shell's ingestion pipeline
 *
 * Example implementations:
 *   - libs/modules/mqtt/src/lib/mqtt-protocol.adapter.ts
 *   - libs/modules/http/src/lib/http-protocol.adapter.ts (future)
 *   - libs/modules/kafka/src/lib/kafka-protocol.adapter.ts (future)
 */

import { Observable } from 'rxjs';
import type { NormalizedMessage } from './normalized-message';
import type { ProtocolConnection, ProtocolConnectionStatus } from '../connections/protocol-connection';

/**
 * The port interface for a protocol adapter.
 * All protocol modules implement this to integrate with the shell.
 */
export interface ProtocolAdapter {
  /**
   * Connect to the protocol source using the provided connection config.
   * Returns a promise that resolves when the connection is established,
   * or rejects if the connection fails.
   */
  connect(connection: ProtocolConnection): Promise<void>;

  /**
   * Disconnect from the protocol source and clean up resources.
   * Any active subscriptions or polls should be stopped.
   */
  disconnect(): Promise<void>;

  /**
   * Observable stream of normalized messages from this adapter.
   * The shell subscribes to this stream to ingest messages.
   *
   * Messages should be emitted as soon as they're normalized.
   * The adapter should NOT buffer or batch messages — the shell
   * handles rate limiting and batching.
   */
  readonly messages$: Observable<NormalizedMessage>;

  /**
   * Current connection state.
   * The shell monitors this to update the UI and handle reconnection logic.
   */
  readonly state$: Observable<ProtocolConnectionStatus>;

  /**
   * Returns true if the adapter supports the given protocol type.
   * Used by the shell to select the correct adapter for a connection.
   */
  supports(protocol: string): boolean;
}

/**
 * Factory function type for creating protocol adapters.
 * Each module exports a factory that the shell uses to instantiate adapters.
 */
export type ProtocolAdapterFactory = () => ProtocolAdapter;
