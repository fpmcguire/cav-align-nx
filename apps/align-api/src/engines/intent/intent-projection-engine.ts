/**
 * intent-projection-engine.ts
 *
 * CAV Level 3 — Intent Projection Engine
 *
 * PURE COMPUTATION ONLY — no Supabase, no side effects.
 *
 * Given a set of active IntentVersions for a tenant, projects i_k(t):
 * the declared intention for a given topic and dimension at a given time.
 *
 * Selection rules (from architecture plan v0.2):
 *   1. Version must have status 'active' (draft versions are silently excluded)
 *   2. Version's effective window must contain the query timestamp
 *   3. Version's topic_scope must match the query topic (MQTT wildcard)
 *   4. When multiple versions match: most-specific-wins (fewest wildcards)
 *   5. Tie-break on artifact precedence (higher wins), then most recently activated
 */

import type { IntentVersion, ProjectedIntention } from '@cav-align/core';
import type { DivergenceDimension } from '@cav-align/core';
import { mqttWildcardMatch, patternSpecificity } from './mqtt-wildcard';

export class IntentProjectionEngine {
  /**
   * Project the active intention for a topic + dimension at a given timestamp.
   *
   * Returns null if:
   *   - No version is active for the topic + dimension at the given time
   *   - All matching versions are in 'draft' status
   *
   * @param versions  All IntentVersions for the tenant+dimension (pre-fetched by store)
   * @param topicPath The exact topic path from the ingested message
   * @param dimension The alignment dimension being evaluated
   * @param at        ISO 8601 timestamp to project at (typically message.timestamp)
   */
  project(
    versions:  IntentVersion[],
    topicPath: string,
    dimension: DivergenceDimension,
    at:        string,
  ): ProjectedIntention | null {
    const atMs = new Date(at).getTime();

    // Filter to versions that are eligible at this point in time
    const candidates = versions.filter((v) => {
      // Draft versions never produce projections (architecture plan §6.1)
      if (v.status !== 'active') return false;

      // Dimension must match
      // (versions are pre-fetched per-dimension, but guard anyway)
      if (!this.dimensionMatches(v, dimension)) return false;

      // Effective window must contain the query timestamp
      const fromMs  = new Date(v.effectiveFrom).getTime();
      const untilMs = v.effectiveUntil ? new Date(v.effectiveUntil).getTime() : Infinity;
      if (atMs < fromMs || atMs >= untilMs) return false;

      // topic_scope must match the topic path via MQTT wildcard
      if (!mqttWildcardMatch(this.getTopicScope(v), topicPath)) return false;

      return true;
    });

    if (candidates.length === 0) return null;

    // Select the best match: most-specific topic_scope, then highest precedence
    const best = this.selectBest(candidates);

    return {
      intentVersionId: best.id,
      artifactId:      best.artifactId,
      topicScope:      this.getTopicScope(best),
      dimension,
      definition:      best.definition,
      effectiveFrom:   best.effectiveFrom,
      effectiveUntil:  best.effectiveUntil,
      projectedAt:     at,
    };
  }

  /**
   * Returns true if the version covers the given dimension.
   * The version's definition discriminant is the source of truth.
   */
  private dimensionMatches(version: IntentVersion, dimension: DivergenceDimension): boolean {
    const def = version.definition;
    // IntentDefinition variants don't carry dimension explicitly —
    // the orchestrator pre-fetches per-dimension, but we can infer from definition shape
    // as a belt-and-suspenders guard.
    switch (dimension) {
      case 'shape':   return 'requiredFields' in def;
      case 'cadence': return 'expectedMeanIntervalMs' in def;
      case 'domain':  return 'numericConstraints' in def;
    }
  }

  /**
   * Extracts topic_scope from a version.
   * Stored on the artifact — for the engine we receive it denormalised on the version
   * via the store's getActive() query. If not present, fall back to '#' (matches all).
   */
  private getTopicScope(version: IntentVersion): string {
    // The store denormalises topicScope onto the version row for engine use
    return (version as unknown as { topicScope?: string }).topicScope ?? '#';
  }

  /**
   * Selects the best candidate from a non-empty list.
   * Priority: lowest specificity score (most specific) → highest precedence → latest effectiveFrom
   */
  private selectBest(candidates: IntentVersion[]): IntentVersion {
    return candidates.reduce((best, current) => {
      const bestScope    = this.getTopicScope(best);
      const currentScope = this.getTopicScope(current);
      const bestSpec     = patternSpecificity(bestScope);
      const currentSpec  = patternSpecificity(currentScope);

      // Lower specificity score = more specific pattern = wins
      if (currentSpec < bestSpec) return current;
      if (currentSpec > bestSpec) return best;

      // Equal specificity — use precedence field (higher wins)
      const bestPrec    = (best    as unknown as { precedence?: number }).precedence ?? 0;
      const currentPrec = (current as unknown as { precedence?: number }).precedence ?? 0;
      if (currentPrec > bestPrec) return current;
      if (currentPrec < bestPrec) return best;

      // Equal precedence — use most recently activated (latest effectiveFrom)
      return new Date(current.effectiveFrom) > new Date(best.effectiveFrom) ? current : best;
    });
  }
}
