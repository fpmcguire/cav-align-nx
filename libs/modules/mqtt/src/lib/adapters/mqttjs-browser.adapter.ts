/**
 * mqttjs-browser.adapter.ts
 *
 * Browser-side MQTT client adapter using mqtt.js over WebSockets.
 * Intended for use in the Angular frontend (apps/mqtt-align).
 *
 * NgZone is injected optionally — the adapter works without Angular
 * but respects zone boundaries when present to avoid flooding
 * change detection with high-frequency broker messages.
 *
 * Ported and refactored from agv-fleet-management-sim.
 */
import { Injectable, NgZone, Optional } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { filter, finalize, share } from 'rxjs/operators';
import mqtt from 'mqtt';
import type { IClientOptions, MqttClient } from 'mqtt';

import type { MqttClientPort, MqttConnectionState } from '../ports/mqtt-client.port';
import { topicMatches } from '../topic-utils';

export interface MqttBrowserConfig {
  /** WebSocket URL, e.g. wss://broker.example.com:8084/mqtt */
  url: string;
  clientId: string;
  username?: string;
  password?: string;
  clean?: boolean;
  keepalive?: number;
  reconnectPeriod?: number;
  connectTimeout?: number;
}

@Injectable({ providedIn: 'root' })
export class MqttJsBrowserAdapter implements MqttClientPort {
  private client: MqttClient | null = null;
  private readonly activeTopicFilters = new Set<string>();

  private readonly stateSubject = new BehaviorSubject<MqttConnectionState>('disconnected');
  readonly state$ = this.stateSubject.asObservable();

  private readonly inbound$ = new Subject<{ topic: string; payload: Uint8Array }>();

  constructor(@Optional() private readonly zone?: NgZone) {}

  connect(): void {
    throw new Error('Use connectWithConfig(cfg) to establish a connection.');
  }

  connectWithConfig(cfg: MqttBrowserConfig): void {
    if (this.client) return;

    const options: IClientOptions = {
      clientId: cfg.clientId,
      username: cfg.username,
      password: cfg.password,
      clean: cfg.clean ?? true,
      keepalive: cfg.keepalive ?? 30,
      reconnectPeriod: cfg.reconnectPeriod ?? 2000,
      connectTimeout: cfg.connectTimeout ?? 10_000,
      protocolVersion: 4,
    };

    this.stateSubject.next('connecting');

    const zone = this.zone ?? {
      run: (fn: () => void) => fn(),
      runOutsideAngular: (fn: () => void) => fn(),
    };

    zone.runOutsideAngular(() => {
      const client = mqtt.connect(cfg.url, options);
      this.client = client;

      client.on('connect', () => zone.run(() => this.stateSubject.next('connected')));
      client.on('reconnect', () => zone.run(() => this.stateSubject.next('reconnecting')));
      client.on('close', () => zone.run(() => this.stateSubject.next('disconnected')));
      client.on('error', () => zone.run(() => this.stateSubject.next('error')));

      client.on('message', (topic: string, payload: Uint8Array) => {
        zone.run(() => this.inbound$.next({ topic, payload: new Uint8Array(payload) }));
      });
    });
  }

  disconnect(): void {
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    this.activeTopicFilters.clear();
    this.stateSubject.next('disconnected');
    c.end(true);
  }

  subscribe(
    topicFilter: string,
    options?: { qos?: 0 | 1 | 2 }
  ): Observable<{ topic: string; payload: Uint8Array }> {
    const client = this.client;
    if (!client) throw new Error('MQTT client not connected');

    if (!this.activeTopicFilters.has(topicFilter)) {
      this.activeTopicFilters.add(topicFilter);
      client.subscribe(topicFilter, { qos: options?.qos ?? 0 }, (err) => {
        if (err) this.stateSubject.next('error');
      });
    }

    return this.inbound$.pipe(
      filter((m) => topicMatches(topicFilter, m.topic)),
      share(),
      finalize(() => {
        // Subscription cleanup — ref-count unsubscribe can be added if needed.
      })
    );
  }

  async publish(
    topic: string,
    payload: string | ArrayBuffer,
    options?: { qos?: 0 | 1 | 2; retain?: boolean }
  ): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('MQTT client not connected');

    const body = typeof payload === 'string' ? payload : new Uint8Array(payload);

    await new Promise<void>((resolve, reject) => {
      client.publish(
        topic,
        body as never,
        { qos: options?.qos ?? 0, retain: options?.retain ?? false },
        (err: Error | undefined) => (err ? reject(err) : resolve())
      );
    });
  }
}
