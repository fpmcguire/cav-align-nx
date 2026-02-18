/**
 * mqtt-client.port.ts
 *
 * The port interface for an MQTT client connection.
 * This interface is intentionally framework-agnostic — it must work
 * in both Angular (browser) and Node (align-api backend) contexts.
 *
 * Implementations:
 *   - MqttJsClientAdapter  : Browser / Angular (mqtt.js over WebSockets)
 *   - NodeMqttClientAdapter: Node / align-api  (mqtt.js over TCP)
 *
 * Ported from agv-fleet-management-sim with NgZone dependency removed.
 */
import { Observable } from 'rxjs';

export type MqttConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface MqttClientPort {
  /** Observable connection state — use with toSignal() in Angular contexts. */
  readonly state$: Observable<MqttConnectionState>;

  connect(): void;
  disconnect(): void;

  publish(
    topic: string,
    payload: string | ArrayBuffer,
    options?: { qos?: 0 | 1 | 2; retain?: boolean }
  ): Promise<void>;

  subscribe(
    topicFilter: string,
    options?: { qos?: 0 | 1 | 2 }
  ): Observable<{ topic: string; payload: Uint8Array }>;
}
