/**
 * mqtt-protocol.adapter.ts
 *
 * The MQTT implementation of the ProtocolAdapter interface.
 * This is the integration point between the MQTT module and the CAV-Align shell.
 *
 * Responsibilities:
 *   - Connect to MQTT broker via MqttJsBrowserAdapter
 *   - Subscribe to configured topic filters
 *   - Normalize incoming MQTT messages → NormalizedMessage
 *   - Emit normalized messages to the shell's ingestion pipeline
 *
 * Used by:
 *   - align-api (backend) — with Node MQTT adapter (future)
 *   - cav-align (frontend) — with browser WebSocket MQTT adapter
 */

import { BehaviorSubject, Observable, Subject, EMPTY } from 'rxjs';
import { map, switchMap, filter, catchError } from 'rxjs/operators';
import type {
  ProtocolAdapter,
  ProtocolConnection,
  MqttConnection,
  ProtocolConnectionStatus,
  NormalizedMessage,
} from '@cav-align/core';
import { MqttJsBrowserAdapter } from '../adapters/mqttjs-browser.adapter';
import type { MqttBrowserConfig } from '../adapters/mqttjs-browser.adapter';
import { normalizeMqttMessage } from '../normalizers/mqtt-message-normalizer';
import type { MqttRawMessage } from '../normalizers/mqtt-message-normalizer';

/**
 * MQTT protocol adapter for the CAV-Align shell.
 * Wraps MqttJsBrowserAdapter and normalizes messages for the ingestion pipeline.
 */
export class MqttProtocolAdapter implements ProtocolAdapter {
  private readonly mqttClient: MqttJsBrowserAdapter;
  private readonly messageSubject = new Subject<NormalizedMessage>();
  private readonly stateSubject = new BehaviorSubject<ProtocolConnectionStatus>('disconnected');

  private currentConnection: MqttConnection | null = null;

  readonly messages$ = this.messageSubject.asObservable();
  readonly state$ = this.stateSubject.asObservable();

  constructor(mqttClient?: MqttJsBrowserAdapter) {
    this.mqttClient = mqttClient ?? new MqttJsBrowserAdapter();

    // Mirror the underlying MQTT client state
    this.mqttClient.state$.subscribe((state) => {
      this.stateSubject.next(state as ProtocolConnectionStatus);
    });
  }

  supports(protocol: string): boolean {
    return protocol === 'mqtt';
  }

  async connect(connection: ProtocolConnection): Promise<void> {
    if (connection.protocol !== 'mqtt') {
      throw new Error(`MqttProtocolAdapter does not support protocol: ${connection.protocol}`);
    }

    this.currentConnection = connection;

    // Convert ProtocolConnection to MqttBrowserConfig
    const config: MqttBrowserConfig = {
      url: this.buildMqttUrl(connection),
      clientId: `${connection.config.clientIdPrefix}${connection.id.slice(0, 8)}`,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 2000,
      connectTimeout: 10_000,
    };

    // Connect to broker
    this.mqttClient.connectWithConfig(config);

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const sub = this.mqttClient.state$.subscribe((state) => {
        if (state === 'connected') {
          sub.unsubscribe();
          resolve();
        } else if (state === 'error') {
          sub.unsubscribe();
          reject(new Error('MQTT connection failed'));
        }
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        sub.unsubscribe();
        reject(new Error('MQTT connection timeout'));
      }, 15_000);
    });

    // Subscribe to all configured topic filters
    this.subscribeToTopics(connection);
  }

  async disconnect(): Promise<void> {
    this.currentConnection = null;
    this.mqttClient.disconnect();
    this.stateSubject.next('disconnected');
  }

  private buildMqttUrl(connection: MqttConnection): string {
    const protocol = connection.config.useTls ? 'wss' : 'ws';
    return `${protocol}://${connection.config.host}:${connection.config.port}/mqtt`;
  }

  private subscribeToTopics(connection: MqttConnection): void {
    const topicFilters = connection.config.topicFilters;

    topicFilters.forEach((filter) => {
      this.mqttClient
        .subscribe(filter, { qos: 0 })
        .pipe(
          map((msg): MqttRawMessage => ({
            topic: msg.topic,
            payload: msg.payload,
            qos: 0, // TODO: Extract from mqtt.js if available
            retain: false,
            dup: false,
          })),
          map((raw) =>
            normalizeMqttMessage(raw, {
              tenantId: connection.tenantId,
              connectionId: connection.id,
            })
          ),
          filter((msg): msg is NormalizedMessage => msg !== null),
          catchError((err) => {
            console.error('Error processing MQTT message:', err);
            return EMPTY;
          })
        )
        .subscribe((normalized) => {
          this.messageSubject.next(normalized);
        });
    });
  }
}
