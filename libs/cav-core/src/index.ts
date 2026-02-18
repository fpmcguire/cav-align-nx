/**
 * @cav-align/core
 *
 * The shared domain type library for CAV-Align.
 * Consumed by: apps/cav-align (Angular), apps/align-api (Node), apps/cav-align-vscode.
 *
 * Import from this lib using the path alias:
 *   import { ObservedTruth, DivergenceEvent, Source } from '@cav-align/core';
 */

// Protocol-agnostic connection types (NEW)
export type {
  ProtocolType,
  ProtocolConnectionStatus,
  BaseProtocolConnection,
  MqttConnection,
  HttpConnection,
  KafkaConnection,
  ProtocolConnection,
  ProtocolConnectionState,
  ProtocolCredentials,
} from './lib/connections/protocol-connection';

// Ingestion types (NEW)
export type {
  NormalizedMessage,
  MessageMetadata,
  MqttMessageMetadata,
  HttpMessageMetadata,
  KafkaMessageMetadata,
  IdentityHints,
} from './lib/ingestion/normalized-message';

export type {
  ProtocolAdapter,
  ProtocolAdapterFactory,
} from './lib/ingestion/protocol-adapter.port';

// Source types (NEW - protocol-agnostic)
export type {
  SourceLifecycleStatus,
  Source,
  SourceSummary,
} from './lib/sources/source';

// Tenant & subscription types (NEW)
export type {
  TenantContext,
  Tenant,
  ModuleSubscription,
  SubscriptionStatus,
  SubscriptionTier,
  BaseModuleLimits,
  MqttModuleLimits,
  ApiModuleLimits,
  KafkaModuleLimits,
  ModuleLimits,
  ModuleUsage,
} from './lib/tenant/tenant-context';

export { hasModule, getModuleSubscription } from './lib/tenant/tenant-context';

// Broker connections (DEPRECATED - kept for backward compatibility)
export type {
  BrokerProtocol,
  BrokerConnectionStatus,
  BrokerConnection,
  BrokerCredentials,
  BrokerConnectionState,
} from './lib/broker';

// Topics (DEPRECATED - kept for backward compatibility)
export type {
  TopicLifecycleStatus,
  Topic,
  TopicSummary,
} from './lib/topic';

// Observed Truth (protocol-agnostic - no changes needed)
export type {
  JsonFieldType,
  ShapeField,
  ObservedShape,
  ObservedCadence,
  NumericFieldProfile,
  CategoricalFieldProfile,
  ObservedDomain,
  ObservedTruth,
} from './lib/observed-truth';

// Divergence (protocol-agnostic - no changes needed)
export type {
  DivergenceDimension,
  DivergenceStatus,
  ShapeDivergenceEvidence,
  CadenceDivergenceEvidence,
  DomainDivergenceEvidence,
  DivergenceEvidence,
  DivergenceEvent,
  DivergenceEventSummary,
} from './lib/divergence';

// Sessions (protocol-agnostic - no changes needed)
export type {
  SessionStatus,
  AlignmentSession,
  SessionStats,
} from './lib/session';

// WebSocket protocol (protocol-agnostic - no changes needed)
export type {
  WsSubscribeFrame,
  WsUnsubscribeFrame,
  WsPingFrame,
  WsClientFrame,
  WsTopicDiscoveredFrame,
  WsTopicStatusChangedFrame,
  WsDivergenceDetectedFrame,
  WsDivergenceResolvedFrame,
  WsSessionStatsFrame,
  WsBrokerStatusFrame,
  WsStatusFrame,
  WsPongFrame,
  WsServerFrame,
} from './lib/ws-protocol';

// API DTOs (will need updating in Step 4 but exported as-is for now)
export type {
  CreateBrokerConnectionRequest,
  UpdateBrokerConnectionRequest,
  BrokerConnectionResponse,
  BrokerConnectionListResponse,
  StartSessionRequest,
  StopSessionRequest,
  SessionResponse,
  SessionListResponse,
  TopicListResponse,
  TopicDetailResponse,
  DivergenceEventListResponse,
  ApiError,
  PaginatedResponse,
} from './lib/api';

// OT configuration (protocol-agnostic - no changes needed)
export type {
  OtInferenceConfig,
  DivergenceDetectionConfig,
  AlignConfig,
} from './lib/ot-config';

export { DEFAULT_ALIGN_CONFIG } from './lib/ot-config';
