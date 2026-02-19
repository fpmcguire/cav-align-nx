/**
 * ingestion-orchestrator.ts
 *
 * Coordinates the ingestion pipeline:
 *   NormalizedMessage
 *     → ObservedTruthEngine (pure)
 *     → ObservedTruthStore  (persist)
 *     → DivergenceEngine    (pure)
 *     → DivergenceStore     (persist)
 *     → ExpectedDivergenceMatcher (pure)
 *     → ExpectedDivergenceStore   (persist)
 *     → WebSocket broadcast
 *
 * CAV Level 1 hardening — orchestrator owns all side effects.
 * Engines are pure. Stores are the only DB layer.
 */

import type { NormalizedMessage, ProtocolConnection, TenantContext } from '@cav-align/core';
import { hasModule } from '@cav-align/core';
import type { AlignWebSocketServer } from '../websocket/websocket-server';
import type { ModuleRegistry } from '../modules/module-registry';
import { ObservedTruthEngine } from '../engines/observed-truth/observed-truth-engine';
import { DivergenceEngine } from '../engines/divergence/divergence-engine';
import { ExpectedDivergenceMatcher } from '../engines/expected-divergence/matcher';
import type { ObservedTruthStore } from '../stores/observed-truth.store';
import type { DivergenceStore } from '../stores/divergence.store';
import type { ExpectedDivergenceStore } from '../stores/expected-divergence.store';
import type { SessionStore } from '../stores/session.store';
import { rootLogger } from '../lib/logger';

const log = rootLogger.child({ context: 'IngestionOrchestrator' });

// ---------------------------------------------------------------------------
// SHA-256 helper (Node built-in crypto.subtle)
// ---------------------------------------------------------------------------
async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface OrchestratorStores {
  observedTruth:      ObservedTruthStore;
  divergence:         DivergenceStore;
  expectedDivergence: ExpectedDivergenceStore;
  session:            SessionStore;
}

export interface OrchestratorStats {
  activeSessions:  number;
  lastMessageAt:   string | null;
}

export class IngestionOrchestrator {
  private readonly otEngine   = new ObservedTruthEngine();
  private readonly divEngine  = new DivergenceEngine();
  private readonly matcher    = new ExpectedDivergenceMatcher();
  private readonly activeSessions = new Set<string>();
  private lastMessageAt: string | null = null;

  constructor(
    private readonly moduleRegistry: ModuleRegistry,
    private readonly wsServer?:      AlignWebSocketServer,
    private readonly stores?:        OrchestratorStores,
  ) {}

  async startIngestion(
    connection: ProtocolConnection,
    tenantContext?: TenantContext,
  ): Promise<void> {
    // ── Entitlement check ────────────────────────────────────────────────
    if (tenantContext && !hasModule(tenantContext, connection.protocol)) {
      throw new Error(
        `Tenant '${tenantContext.tenant.id}' does not have an active ${connection.protocol.toUpperCase()} module subscription`,
      );
    }

    const adapter = this.moduleRegistry.getOrCreateAdapter(connection);

    const isConnected = await new Promise<boolean>((resolve) => {
      const sub = adapter.state$.subscribe((state) => {
        if (state === 'connected') { sub.unsubscribe(); resolve(true); }
        else if (state === 'error') { sub.unsubscribe(); resolve(false); }
      });
    });

    if (!isConnected) {
      await adapter.connect(connection);
    }

    // Record session start
    await this.stores?.session.startSession({
      tenantId:     connection.tenantId ?? 'unknown',
      connectionId: connection.id,
      protocol:     connection.protocol,
      startedAt:    new Date().toISOString(),
    });

    this.activeSessions.add(connection.id);

    adapter.messages$.subscribe({
      next:  (msg) => void this.processMessage(msg),
      error: (err) => log.error(`Stream error for ${connection.id}`, err),
    });

    log.info('Ingestion started', { connectionId: connection.id, protocol: connection.protocol });
  }

  async stopIngestion(connectionId: string, tenantId: string): Promise<void> {
    this.activeSessions.delete(connectionId);
    await this.moduleRegistry.disconnectAdapter(connectionId);

    await this.stores?.session.stopSession({
      tenantId,
      connectionId,
      stoppedAt:    new Date().toISOString(),
      health:       'healthy',
      messageCount: 0,
    });

    log.info('Ingestion stopped', { connectionId });
  }

  // ---------------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------------

  getStats(): OrchestratorStats {
    return {
      activeSessions: this.activeSessions.size,
      lastMessageAt:  this.lastMessageAt,
    };
  }

  private async processMessage(msg: NormalizedMessage): Promise<void> {
    this.lastMessageAt = msg.timestamp;
    try {
      // ── 1. Observed Truth (pure) ──────────────────────────────────────────
      const otResult = this.otEngine.ingest(msg);

      // ── 2. Persist new source ────────────────────────────────────────────
      if (otResult.isNew && this.stores) {
        const hash = await sha256(msg.sourceId);
        const dbSourceId = await this.stores.observedTruth.upsertSource({
          tenantId:             msg.tenantId,
          connectionId:         msg.connectionId,
          protocol:             msg.metadata.protocol,
          sourceIdentifier:     msg.sourceId,
          sourceIdentifierHash: hash,
          firstSeenAt:          msg.timestamp,
          lastSeenAt:           msg.timestamp,
        });
        if (dbSourceId) this.otEngine.setDbSourceId(msg, dbSourceId);
      }

      // ── 3. Throttled count update ────────────────────────────────────────
      if (this.otEngine.shouldUpdateCount(msg) && this.stores && otResult.dbSourceId) {
        await this.stores.observedTruth.updateSourceCount({
          tenantId:      msg.tenantId,
          dbSourceId:    otResult.dbSourceId,
          messageCount:  this.otEngine.getMessageCount(msg),
          lastMessageAt: msg.timestamp,
        });
      }

      // ── 4. Persist Observed Truth on establishment ───────────────────────
      if (otResult.justEstablished && otResult.observedTruth && this.stores && otResult.dbSourceId) {
        const dbOtId = await this.stores.observedTruth.insertObservedTruth({
          tenantId:   msg.tenantId,
          dbSourceId: otResult.dbSourceId,
          ot:         otResult.observedTruth,
        });
        if (dbOtId) {
          this.otEngine.setDbObservedTruthId(msg, dbOtId);
          await this.stores.observedTruth.markSourceEstablished({
            tenantId:          msg.tenantId,
            dbSourceId:        otResult.dbSourceId,
            dbObservedTruthId: dbOtId,
          });
        }

        this.wsServer?.broadcastToSession(msg.connectionId, {
          type:      'topic:status-changed',
          sessionId: msg.connectionId,
          topicId:   msg.sourceId,
          status:    'established',
        });

        log.info('OT established', { tenantId: msg.tenantId, sourceId: msg.sourceId });
      }

      // ── 5. Divergence detection (only after OT established) ──────────────
      if (!otResult.established || !otResult.observedTruth) return;

      const divResults = this.divEngine.detect(msg, otResult.observedTruth);

      for (const result of divResults) {
        // ── 6a. Newly confirmed — persist + broadcast ──────────────────────
        if (result.status === 'confirmed' && result.newlyConfirmed && this.stores) {
          const nc = result.newlyConfirmed;
          const dbEventId = await this.stores.divergence.insertEvent({
            tenantId:         msg.tenantId,
            dbSourceId:       otResult.dbSourceId,
            dbObservedTruthId: otResult.dbObservedTruthId,
            dimension:        result.dimension,
            onsetEstimatedAt: nc.onsetEstimatedAt,
            confirmedAt:      nc.confirmedAt,
            evidence:         nc.evidence,
            deviceId:         nc.deviceId,
            userId:           nc.userId,
            entityType:       nc.entityType,
          });

          if (dbEventId) {
            this.divEngine.setDbEventId(msg, result.dimension, dbEventId);

            // ── 7. Expected Divergence matching ─────────────────────────────
            if (this.stores) {
              const pending = await this.stores.expectedDivergence.fetchPending(msg.tenantId);
              const matchResult = this.matcher.match(
                {
                  id:               dbEventId,
                  tenantId:         msg.tenantId,
                  topicId:          msg.sourceId,
                  dimension:        result.dimension,
                  onsetEstimatedAt: nc.onsetEstimatedAt,
                  deviceId:         nc.deviceId,
                },
                pending,
              );

              if (matchResult.label === 'confirmed_planned_change' && matchResult.matchedExpectationId) {
                await this.stores.expectedDivergence.confirmExpectation({
                  tenantId:           msg.tenantId,
                  id:                 matchResult.matchedExpectationId,
                  eventId:            dbEventId,
                  existingMatchedIds: matchResult.matchedExpectationMatchedIds ?? [],
                });
                log.info('Divergence matched to expectation', {
                  tenantId:      msg.tenantId,
                  eventId:       dbEventId,
                  expectationId: matchResult.matchedExpectationId,
                });
              }
            }
          }

          this.wsServer?.broadcastToSession(msg.connectionId, {
            type:      'divergence:detected',
            sessionId: msg.connectionId,
            event: {
              id:         result.dbEventId ?? crypto.randomUUID(),
              topicPath:  msg.sourceId,
              dimension:  result.dimension,
              status:     'confirmed',
              confirmedAt: result.newlyConfirmed?.confirmedAt,
              changeKind: ('changeKind' in result.newlyConfirmed.evidence
                ? result.newlyConfirmed.evidence.changeKind
                : 'unknown') as string,
            },
          });

          log.info('Divergence confirmed', {
            tenantId:  msg.tenantId,
            sourceId:  msg.sourceId,
            dimension: result.dimension,
          });
        }

        // ── 6b. Resolved ─────────────────────────────────────────────────
        if (result.status === 'resolved' && result.resolvedEventId && this.stores) {
          await this.stores.divergence.resolveEvent({
            tenantId:    msg.tenantId,
            dbEventId:   result.resolvedEventId,
            resolvedAt:  msg.timestamp,
          });

          this.wsServer?.broadcastToSession(msg.connectionId, {
            type:      'divergence:resolved',
            sessionId: msg.connectionId,
            eventId:   result.resolvedEventId,
          });

          log.info('Divergence resolved', {
            tenantId: msg.tenantId,
            eventId:  result.resolvedEventId,
          });
        }
      }
    } catch (err) {
      log.error('processMessage error', err, { tenantId: msg.tenantId, sourceId: msg.sourceId });
    }
  }
}
