/**
 * ingestion-orchestrator.ts
 *
 * Orchestrates the ingestion pipeline:
 *   NormalizedMessage → OT inference → Divergence detection → Expected Divergence matching
 *   → Supabase persistence → WebSocket broadcast
 */

import type { NormalizedMessage, ProtocolConnection } from '@cav-align/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModuleRegistry } from '../modules/module-registry';
import type { AlignWebSocketServer } from '../websocket/websocket-server';
import { ObservedTruthEngine } from '../engines/observed-truth/observed-truth-engine';
import { DivergenceEngine } from '../engines/divergence/divergence-engine';
import { ExpectedDivergenceMatcher } from '../engines/expected-divergence/matcher';

export class IngestionOrchestrator {
  private readonly observedTruthEngine: ObservedTruthEngine;
  private readonly divergenceEngine: DivergenceEngine;
  private readonly matcher: ExpectedDivergenceMatcher | undefined;

  constructor(
    private readonly moduleRegistry: ModuleRegistry,
    private readonly wsServer?: AlignWebSocketServer,
    supabase?: SupabaseClient,
  ) {
    this.observedTruthEngine = new ObservedTruthEngine(supabase, wsServer);
    this.divergenceEngine = new DivergenceEngine(supabase, wsServer);
    this.matcher = supabase ? new ExpectedDivergenceMatcher(supabase) : undefined;
  }

  async startIngestion(connection: ProtocolConnection): Promise<void> {
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

    adapter.messages$.subscribe({
      next: (msg) => this.processMessage(msg),
      error: (err) => {
        console.error(`[Orchestrator] Error in message stream for ${connection.id}:`, err);
      },
    });

    console.log(`[Orchestrator] Started ingestion for connection ${connection.id}`);
  }

  async stopIngestion(connectionId: string): Promise<void> {
    await this.moduleRegistry.disconnectAdapter(connectionId);
    console.log(`[Orchestrator] Stopped ingestion for connection ${connectionId}`);
  }

  private async processMessage(msg: NormalizedMessage): Promise<void> {
    try {
      // 1. Observed Truth inference
      const otUpdate = await this.observedTruthEngine.ingest(msg);

      // 2. Divergence detection (only if OT established)
      if (otUpdate.established && otUpdate.observedTruth) {
        const results = await this.divergenceEngine.detect(
          msg,
          otUpdate.observedTruth,
          otUpdate.dbSourceId,
          otUpdate.dbObservedTruthId,
        );

        // 3. Expected Divergence matching (only for newly confirmed events)
        for (const result of results) {
          if (result.status === 'confirmed' && result.dbEventId && this.matcher) {
            const matchResult = await this.matcher.matchEvent({
              id: result.dbEventId,
              tenantId: msg.tenantId,
              topicId: msg.sourceId,
              dimension: result.dimension,
              onsetEstimatedAt: msg.timestamp,
              deviceId: msg.identityHints?.deviceId ?? null,
            });

            if (matchResult.label !== 'unplanned_divergence') {
              console.log(
                `[Orchestrator] Divergence ${result.dbEventId} labeled: ${matchResult.label}`,
              );
            }
          }
        }
      }
    } catch (err) {
      console.error('[Orchestrator] processMessage error:', err);
    }
  }
}
