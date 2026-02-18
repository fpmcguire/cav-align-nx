/**
 * protocol-connection.ts
 *
 * Protocol-agnostic connection definitions for the CAV-Align shell.
 * Each protocol module (MQTT, API, Kafka) extends the base connection
 * with protocol-specific configuration.
 *
 * This replaces the MQTT-specific BrokerConnection from v0.
 */

export type ProtocolType = 'mqtt' | 'http' | 'kafka';

export type ProtocolConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/**
 * Base protocol connection — all protocols extend this.
 */
export interface BaseProtocolConnection {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly protocol: ProtocolType;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * MQTT-specific connection configuration.
 */
export interface MqttConnection extends BaseProtocolConnection {
  readonly protocol: 'mqtt';
  readonly config: {
    readonly host: string;
    readonly port: number;
    readonly useTls: boolean;
    readonly clientIdPrefix: string;
    readonly topicFilters: string[];  // e.g., ['#'] or ['vda5050/+/+/state']
  };
}

/**
 * HTTP/REST API connection configuration.
 * (Future: API Align module)
 */
export interface HttpConnection extends BaseProtocolConnection {
  readonly protocol: 'http';
  readonly config: {
    readonly baseUrl: string;
    readonly endpoints: string[];        // e.g., ['/api/devices/{id}/telemetry']
    readonly method: 'GET' | 'POST';
    readonly pollingIntervalMs?: number;
  };
}

/**
 * Kafka connection configuration.
 * (Future: Kafka Align module)
 */
export interface KafkaConnection extends BaseProtocolConnection {
  readonly protocol: 'kafka';
  readonly config: {
    readonly brokers: string[];
    readonly topics: string[];
    readonly groupId: string;
  };
}

/**
 * Discriminated union of all protocol connection types.
 * Use this as the canonical connection type throughout the shell.
 */
export type ProtocolConnection =
  | MqttConnection
  | HttpConnection
  | KafkaConnection;

/**
 * Runtime connection state — not persisted, held in memory by align-api
 * and pushed to the frontend via WebSocket.
 */
export interface ProtocolConnectionState {
  readonly connectionId: string;
  readonly status: ProtocolConnectionStatus;
  readonly lastConnectedAt?: string;
  readonly lastErrorMessage?: string;
  readonly activeSourceCount: number;  // Sources currently being observed
}

/**
 * Credentials are kept separately and never returned to the frontend
 * in plaintext after initial creation.
 */
export interface ProtocolCredentials {
  readonly connectionId: string;
  readonly username?: string;
  readonly password?: string;
  readonly apiKey?: string;
  readonly saslMechanism?: string;  // Kafka SASL
  readonly [key: string]: unknown;  // Protocol-specific credentials
}
