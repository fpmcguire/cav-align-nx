/**
 * cadence-calculator.ts
 *
 * Computes inter-arrival time statistics over a rolling window.
 * Used by the Observed Truth engine to establish the Cadence dimension.
 */

import type { ObservedCadence } from '@cav-align/core';

const ROLLING_WINDOW_SIZE = 1000;

// ---------------------------------------------------------------------------
// CadenceAccumulator
// ---------------------------------------------------------------------------

export class CadenceAccumulator {
  private intervals: number[] = [];

  addInterval(intervalMs: number): void {
    if (intervalMs < 0) return;
    this.intervals.push(intervalMs);
    if (this.intervals.length > ROLLING_WINDOW_SIZE) {
      this.intervals.shift();
    }
  }

  get sampleSize(): number {
    return this.intervals.length;
  }

  buildCadence(): ObservedCadence {
    const n = this.intervals.length;

    if (n === 0) {
      const now = new Date().toISOString();
      return {
        meanIntervalMs: 0,
        stdDevIntervalMs: 0,
        p5IntervalMs: 0,
        p95IntervalMs: 0,
        minIntervalMs: 0,
        maxIntervalMs: 0,
        sampleSize: 0,
        inferredAt: now,
      };
    }

    const sorted = [...this.intervals].sort((a, b) => a - b);
    const mean = this.intervals.reduce((s, v) => s + v, 0) / n;

    const variance =
      n > 1
        ? this.intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
        : 0;
    const stdDev = Math.sqrt(variance);

    const p5  = percentile(sorted, 0.05);
    const p95 = percentile(sorted, 0.95);

    return {
      meanIntervalMs: mean,
      stdDevIntervalMs: stdDev,
      p5IntervalMs: p5,
      p95IntervalMs: p95,
      minIntervalMs: sorted[0],
      maxIntervalMs: sorted[n - 1],
      sampleSize: n,
      inferredAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Cadence divergence detection (standalone helper)
// ---------------------------------------------------------------------------

export interface CadenceDivergenceResult {
  isDivergent: boolean;
  changeKind?: 'faster' | 'slower' | 'irregular' | 'silent';
  observedIntervalMs: number;
}

export function detectCadenceDivergence(
  currentIntervalMs: number,
  cadence: ObservedCadence,
  staleMultiplier = 3.0,
): CadenceDivergenceResult {
  const { meanIntervalMs, stdDevIntervalMs } = cadence;

  // If mean is 0, no baseline — skip
  if (meanIntervalMs === 0) {
    return { isDivergent: false, observedIntervalMs: currentIntervalMs };
  }

  const lowerBound = meanIntervalMs - staleMultiplier * stdDevIntervalMs;
  const upperBound = meanIntervalMs + staleMultiplier * stdDevIntervalMs;

  if (currentIntervalMs < lowerBound) {
    return { isDivergent: true, changeKind: 'faster', observedIntervalMs: currentIntervalMs };
  }
  if (currentIntervalMs > upperBound) {
    return { isDivergent: true, changeKind: 'slower', observedIntervalMs: currentIntervalMs };
  }

  return { isDivergent: false, observedIntervalMs: currentIntervalMs };
}

export function detectCadenceSilence(
  lastMessageAt: string,
  cadence: ObservedCadence,
  staleMultiplier = 3.0,
): boolean {
  if (cadence.meanIntervalMs === 0) return false;
  const silenceThresholdMs =
    cadence.meanIntervalMs + staleMultiplier * cadence.stdDevIntervalMs;
  const elapsedMs = Date.now() - new Date(lastMessageAt).getTime();
  return elapsedMs > silenceThresholdMs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = p * (sortedArr.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedArr[lower];
  return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (idx - lower);
}
