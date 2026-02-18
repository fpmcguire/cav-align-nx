/**
 * broker.ts
 *
 * @deprecated This file contains MQTT-specific types that are being replaced
 * by protocol-agnostic types in connections/protocol-connection.ts
 *
 * BrokerConnection → ProtocolConnection
 * BrokerConnectionState → ProtocolConnectionState
 * BrokerCredentials → ProtocolCredentials
 *
 * These types remain as aliases for backward compatibility during migration.
 * New code should import from connections/protocol-connection.ts
 */

import type {
  MqttConnection,
  ProtocolConnectionState as NewProtocolConnectionState,
  ProtocolCredentials as NewProtocolCredentials,
} from './connections/protocol-connection';

/**
 * @deprecated Use ProtocolType from connections/protocol-connection.ts
 */
export type BrokerProtocol = 'mqtt';

/**
 * @deprecated Use ProtocolConnectionStatus from connections/protocol-connection.ts
 */
export type BrokerConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/**
 * @deprecated Use MqttConnection from connections/protocol-connection.ts
 */
export interface BrokerConnection {
  readonly id: string;
  readonly organisationId: string;
  readonly name: string;
  readonly protocol: BrokerProtocol;
  readonly host: string;
  readonly port: number;
  readonly useTls: boolean;
  readonly clientIdPrefix: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * @deprecated Use ProtocolCredentials from connections/protocol-connection.ts
 */
export interface BrokerCredentials {
  readonly connectionId: string;
  readonly username?: string;
  readonly password?: string;
}

/**
 * @deprecated Use ProtocolConnectionState from connections/protocol-connection.ts
 */
export interface BrokerConnectionState {
  readonly connectionId: string;
  readonly status: BrokerConnectionStatus;
  readonly lastConnectedAt?: string;
  readonly lastErrorMessage?: string;
  readonly activeTopicCount: number;
}
