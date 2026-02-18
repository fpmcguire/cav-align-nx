/**
 * ingestion-orchestrator.ts
 *
 * Orchestrates the ingestion of NormalizedMessage objects from protocol adapters.
 * Routes messages through:
 *   1. Source discovery/creation
 *   2. Observed Truth inference
 *   3. Divergence detection
 *   4. Evidence storage
 *   5. WebSocket broadcast
 *
 * This is the core of the CAV-Align shell's message processing pipeline.
 */

import type { NormalizedMessage, ProtocolConnection } from '@cav-align/core';
import type { ModuleRegistry } from '../modules/module-registry';
import { ObservedTruthEngine } from '../engines/observed-truth/observed-truth-engine';
import { DivergenceEngine } from '../engines/divergence/divergence-engine';

export class IngestionOrchestrator {
  private readonly observedTruthEngine: ObservedTruthEngine;
  private readonly divergenceEngine: DivergenceEngine;

  constructor(private readonly moduleRegistry: ModuleRegistry) {
    this.observedTruthEngine = new ObservedTruthEngine();
    this.divergenceEngine = new DivergenceEngine();
  }

  /**
   * Start ingestion for a connection.
   * Connects the protocol adapter and subscribes to its message stream.
   */
  async startIngestion(connection: ProtocolConnection): Promise<void> {
    // Get or create the protocol adapter
    const adapter = this.moduleRegistry.getOrCreateAdapter(connection);

    // Connect if not already connected
    const isConnected = await new Promise<boolean>((resolve) => {
      const sub = adapter.state$.subscribe((state) => {
        if (state === 'connected') {
          sub.unsubscribe();
          resolve(true);
        } else if (state === 'error') {
          sub.unsubscribe();
          resolve(false);
        }
      });
    });

    if (!isConnected) {
      await adapter.connect(connection);
    }

    // Subscribe to normalized messages
    adapter.messages$.subscribe({
      next: (msg) => this.processMessage(msg),
      error: (err) => {
        console.error(
          `[IngestionOrchestrator] Error in message stream for connection ${connection.id}:`,
          err
        );
      },
    });

    console.log(`[IngestionOrchestrator] Started ingestion for connection ${connection.id}`);
  }

  /**
   * Stop ingestion for a connection.
   */
  async stopIngestion(connectionId: string): Promise<void> {
    await this.moduleRegistry.disconnectAdapter(connectionId);
    console.log(`[IngestionOrchestrator] Stopped ingestion for connection ${connectionId}`);
  }

  /**
   * Process a single normalized message through the pipeline.
   */
  private async processMessage(msg: NormalizedMessage): Promise<void> {
    try {
      // 1. Update Observed Truth
      const otUpdate = await this.observedTruthEngine.ingest(msg);

      // 2. Check for divergence (if OT is established)
      if (otUpdate?.established && otUpdate.observedTruth) {
        const divergence = await this.divergenceEngine.detect(msg, otUpdate.observedTruth);
        
        if (divergence) {
          console.log(
            `[IngestionOrchestrator] Divergence detected: ${divergence.dimension} ` +
            `for source ${msg.sourceId}`
          );
          // TODO: Persist divergence event
          // TODO: Broadcast via WebSocket
        }
      }

      // 3. Store evidence sample (if configured)
      // TODO: Implement evidence storage

    } catch (err) {
      console.error('[IngestionOrchestrator] Error processing message:', err);
    }
  }
}
