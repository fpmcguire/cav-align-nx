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
import type { DivergenceDimension } from '@cav-align/core';
import { hasModule } from '@cav-align/core';
import type { AlignWebSocketServer } from '../websocket/websocket-server';
import type { ModuleRegistry } from '../modules/module-registry';
import { ObservedTruthEngine } from '../engines/observed-truth/observed-truth-engine';
import { DivergenceEngine } from '../engines/divergence/divergence-engine';
import { ExpectedDivergenceMatcher } from '../engines/expected-divergence/matcher';
import { IntentProjectionEngine } from '../engines/intent/intent-projection-engine';
import { DeltaEngine } from '../engines/delta/delta-engine';
import { EnvelopeEvaluator } from '../engines/envelope/envelope-evaluator';
import type { ObservedTruthStore } from '../stores/observed-truth.store';
import type { DivergenceStore } from '../stores/divergence.store';
import type { ExpectedDivergenceStore } from '../stores/expected-divergence.store';
import type { SessionStore } from '../stores/session.store';
import type { IntentVersionStore } from '../stores/intent-version.store';
import type { DeltaStore } from '../stores/delta.store';
import type { BreachStore } from '../stores/breach.store';
import type { ConvergenceActionStore } from '../stores/convergence-action.store';
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
  // CAV Level 4 — v2 stores (optional — v2 branch is no-op when absent)
  intentVersion?:     IntentVersionStore;
  delta?:             DeltaStore;
  breach?:            BreachStore;
  convergenceAction?: ConvergenceActionStore;
}

export interface OrchestratorStats {
  activeSessions:  number;
  lastMessageAt:   string | null;
}

export class IngestionOrchestrator {
  // v1 engines (frozen)
  private readonly otEngine   = new ObservedTruthEngine();
  private readonly divEngine  = new DivergenceEngine();
  private readonly matcher    = new ExpectedDivergenceMatcher();
  // v2 engines (pure — no state)
  private readonly intentEngine   = new IntentProjectionEngine();
  private readonly deltaEngine    = new DeltaEngine();
  private readonly envelopeEngine = new EnvelopeEvaluator();

  private readonly activeSessions = new Set<string>();
  private readonly sessionMap = new Map<string, string>(); // connectionId → sessionId
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
    const sessionId = await this.stores?.session.startSession({
      tenantId:     connection.tenantId ?? 'unknown',
      connectionId: connection.id,
      protocol:     connection.protocol,
      startedAt:    new Date().toISOString(),
    });

    if (!sessionId) {
      log.error('CRITICAL: Failed to create session — aborting connection startup', {
        connectionId: connection.id,
        protocol: connection.protocol,
      });
      throw new Error('Session creation failed');
    }

    // Store mapping for later use
    this.sessionMap.set(connection.id, sessionId);
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

    // Retrieve sessionId from map
    const sessionId = this.sessionMap.get(connectionId);
    if (!sessionId) {
      log.error('No session ID found for connection — cannot stop session', { connectionId });
      return;
    }

    await this.stores?.session.stopSession({
      tenantId,
      sessionId,
      stoppedAt:    new Date().toISOString(),
      health:       'healthy',
      messageCount: 0,
    });

    // Clean up mapping
    this.sessionMap.delete(connectionId);

    log.info('Ingestion stopped', { connectionId, sessionId });
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

        // Broadcast using actual sessionId from DB
        const sessionId = this.sessionMap.get(msg.connectionId);
        if (sessionId) {
          this.wsServer?.broadcastToSession(sessionId, {
            type:      'topic:status-changed',
            sessionId: sessionId,
            topicId:   msg.sourceId,
            status:    'established',
          });
        }

        log.info('OT established', { tenantId: msg.tenantId, sourceId: msg.sourceId });
      }

      // ── 5. Divergence detection (only after OT established) ──────────────
      if (!otResult.established || !otResult.observedTruth) return;

      // ── v2 branch: Intent + Delta + Breach (parallel, non-blocking) ──────
      void this.runV2Branch(msg, otResult.observedTruth, otResult.dbObservedTruthId);

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

          // Broadcast using actual sessionId from DB
          const sessionId = this.sessionMap.get(msg.connectionId);
          if (sessionId) {
            this.wsServer?.broadcastToSession(sessionId, {
              type:      'divergence:detected',
              sessionId: sessionId,
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
          }

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

          // Broadcast using actual sessionId from DB
          const sessionId = this.sessionMap.get(msg.connectionId);
          if (sessionId) {
            this.wsServer?.broadcastToSession(sessionId, {
              type:      'divergence:resolved',
              sessionId: sessionId,
              eventId:   result.resolvedEventId,
            });
          }

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

  // ---------------------------------------------------------------------------
  // v2 Pipeline Branch — Intent + Delta + Breach
  // Runs in parallel to v1. A no-op if no v2 stores are configured or
  // if no active intent version exists for the message topic + dimension.
  // ---------------------------------------------------------------------------

  private async runV2Branch(
    msg:             NormalizedMessage,
    observedTruth:   import('@cav-align/core').ObservedTruth,
    dbObservedTruthId: string | undefined,
  ): Promise<void> {
    if (!this.stores?.intentVersion || !this.stores?.delta || !this.stores?.breach) return;
    if (!dbObservedTruthId) return;

    const dimensions: DivergenceDimension[] = ['shape', 'cadence', 'domain'];
    const at = msg.timestamp;

    for (const dimension of dimensions) {
      try {
        // 1. Fetch all active intent versions for this tenant + dimension
        const versions = await this.stores.intentVersion.getActiveForDimension(
          msg.tenantId, dimension, at,
        );
        if (versions.length === 0) continue;

        // 2. Project i_k(t) — engine selects best matching version
        const projected = this.intentEngine.project(versions, msg.sourceId, dimension, at);
        if (!projected) continue;

        // 3. Compute Delta_k(t) = D_k(i_k(t), s_k(t))
        const deltaResult = this.deltaEngine.compute(projected, observedTruth, dimension);

        // 4. Evaluate envelope
        const assessment = this.envelopeEngine.evaluate(deltaResult, projected.definition);

        // Override withinEnvelope from assessment (engine computes value; evaluator judges threshold)
        const withinEnvelope = !assessment.breached;

        // 5. Persist delta
        const deltaId = await this.stores.delta.persist({
          tenantId:        msg.tenantId,
          intentVersionId: projected.intentVersionId,
          observedTruthId: dbObservedTruthId,
          topicScope:      projected.topicScope,
          dimension,
          deltaValue:      deltaResult.value,
          deltaDetail:     deltaResult.detail,
          withinEnvelope,
          computedAt:      at,
        });

        if (!deltaId) continue;

        // 6. Breach management
        const activeBreach = await this.stores.breach.getActiveBreach(
          msg.tenantId, projected.topicScope, dimension, projected.intentVersionId,
        );

        if (!withinEnvelope && !activeBreach) {
          // Open new breach
          const breachId = await this.stores.breach.open({
            tenantId:        msg.tenantId,
            intentVersionId: projected.intentVersionId,
            firstDeltaId:    deltaId,
            topicScope:      projected.topicScope,
            dimension,
            evidence:        assessment.evidence,
            breachedAt:      at,
          });

          if (breachId) {
            this.wsServer?.broadcastToTenant(msg.tenantId, {
              type:            'breach:detected',
              tenantId:        msg.tenantId,
              breachId,
              intentVersionId: projected.intentVersionId,
              topicScope:      projected.topicScope,
              dimension,
              severity:        assessment.severity,
              deltaValue:      deltaResult.value,
              reason:          deltaResult.detail.reason,
              breachedAt:      at,
            });

            log.info('Envelope breach opened', {
              tenantId:  msg.tenantId,
              topicScope: projected.topicScope,
              dimension,
              breachId,
              severity:  assessment.severity,
            });
          }
        } else if (withinEnvelope && activeBreach) {
          // Resolve existing breach
          await this.stores.breach.resolve(msg.tenantId, activeBreach.id, at);

          this.wsServer?.broadcastToTenant(msg.tenantId, {
            type:            'breach:resolved',
            tenantId:        msg.tenantId,
            breachId:        activeBreach.id,
            topicScope:      projected.topicScope,
            dimension,
            resolvedAt:      at,
            finalDeltaValue: deltaResult.value,
          });

          log.info('Envelope breach resolved', {
            tenantId:  msg.tenantId,
            breachId:  activeBreach.id,
            dimension,
          });

          // Retrospectively link post-action delta if there are pending actions
          if (this.stores.convergenceAction) {
            const actions = await this.stores.convergenceAction.listForBreach(
              msg.tenantId, activeBreach.id,
            );
            for (const action of actions.filter((a) => !a.postActionDeltaId)) {
              if (new Date(action.actionTakenAt).getTime() < new Date(at).getTime()) {
                const preBreach  = activeBreach.evidence.deltaValue;
                const postDelta  = deltaResult.value;
                const effectiveness =
                  postDelta < preBreach * 0.95 ? 'converging' :
                  postDelta > preBreach * 1.05 ? 'diverging'  : 'stable';

                await this.stores.convergenceAction.linkPostActionDelta(
                  msg.tenantId, action.id, deltaId, effectiveness,
                );
              }
            }
          }
        }
      } catch (err) {
        log.error('v2 branch error', err, {
          tenantId:  msg.tenantId,
          sourceId:  msg.sourceId,
          dimension,
        });
      }
    }
  }
}
