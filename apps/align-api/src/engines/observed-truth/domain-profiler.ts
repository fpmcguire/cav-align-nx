/**
 * domain-profiler.ts
 *
 * Profiles the value domains of JSON payload fields.
 * Numeric fields → range/statistics. Categorical fields → observed value sets.
 *
 * Uses Welford's online algorithm for numeric stats (memory-efficient).
 */

import type { NumericFieldProfile, CategoricalFieldProfile, ObservedDomain } from '@cav-align/core';
import { DEFAULT_ALIGN_CONFIG } from '@cav-align/core';

// ---------------------------------------------------------------------------
// Welford online algorithm state
// ---------------------------------------------------------------------------

interface WelfordState {
  n: number;
  mean: number;
  m2: number;   // sum of squared deviations from mean
  min: number;
  max: number;
  values: number[]; // kept for percentile calc (up to 1000)
}

function welfordUpdate(state: WelfordState, value: number): void {
  state.n++;
  const delta = value - state.mean;
  state.mean += delta / state.n;
  const delta2 = value - state.mean;
  state.m2 += delta * delta2;

  if (value < state.min) state.min = value;
  if (value > state.max) state.max = value;

  if (state.values.length < 1000) state.values.push(value);
}

function welfordFinalize(state: WelfordState): { mean: number; stdDev: number; p5: number; p95: number } {
  const variance = state.n > 1 ? state.m2 / (state.n - 1) : 0;
  const sorted = [...state.values].sort((a, b) => a - b);
  return {
    mean: state.mean,
    stdDev: Math.sqrt(variance),
    p5: percentile(sorted, 0.05),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ---------------------------------------------------------------------------
// DomainProfiler
// ---------------------------------------------------------------------------

export class DomainProfiler {
  private numericStates = new Map<string, WelfordState>();
  private categoricalSets = new Map<string, { values: Set<string>; count: number; isOpenSet: boolean }>();
  private sampleCount = 0;

  private readonly cardinalityLimit: number;

  constructor(cardinalityLimit = DEFAULT_ALIGN_CONFIG.inference.domainCategoricalCardinalityLimit) {
    this.cardinalityLimit = cardinalityLimit;
  }

  addSample(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return;
    this.sampleCount++;
    this.extractValues(payload as Record<string, unknown>, '');
  }

  private extractValues(obj: Record<string, unknown>, prefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) continue;

      if (typeof value === 'number' && isFinite(value)) {
        this.addNumeric(path, value);
      } else if (typeof value === 'string') {
        this.addCategorical(path, value);
      } else if (typeof value === 'boolean') {
        this.addCategorical(path, String(value));
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        this.extractValues(value as Record<string, unknown>, path);
      }
    }
  }

  private addNumeric(path: string, value: number): void {
    let state = this.numericStates.get(path);
    if (!state) {
      state = { n: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity, values: [] };
      this.numericStates.set(path, state);
    }
    welfordUpdate(state, value);
  }

  private addCategorical(path: string, value: string): void {
    let cat = this.categoricalSets.get(path);
    if (!cat) {
      cat = { values: new Set(), count: 0, isOpenSet: false };
      this.categoricalSets.set(path, cat);
    }
    cat.count++;
    if (!cat.isOpenSet) {
      cat.values.add(value);
      if (cat.values.size > this.cardinalityLimit) {
        cat.isOpenSet = true;
        cat.values.clear(); // Don't keep an unbounded set
      }
    }
  }

  buildDomain(): ObservedDomain {
    const numericFields: NumericFieldProfile[] = [];
    for (const [path, state] of this.numericStates) {
      if (state.n < 2) continue; // Need at least 2 samples for stats
      const { mean, stdDev, p5, p95 } = welfordFinalize(state);
      numericFields.push({
        fieldPath: path,
        min: state.min,
        max: state.max,
        mean,
        stdDev,
        p5,
        p95,
        sampleSize: state.n,
      });
    }

    const categoricalFields: CategoricalFieldProfile[] = [];
    for (const [path, cat] of this.categoricalSets) {
      categoricalFields.push({
        fieldPath: path,
        observedValues: Array.from(cat.values),
        isOpenSet: cat.isOpenSet,
        sampleSize: cat.count,
      });
    }

    return {
      numericFields,
      categoricalFields,
      sampleSize: this.sampleCount,
      inferredAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Domain divergence detection (standalone helper)
// ---------------------------------------------------------------------------

export interface DomainDivergenceResult {
  isDivergent: boolean;
  fieldPath?: string;
  changeKind?: 'out-of-range' | 'unexpected-value';
  observedValue?: number | string;
}

export function detectDomainDivergence(
  payload: unknown,
  domain: ObservedDomain,
  stdDevMultiplier = DEFAULT_ALIGN_CONFIG.detection.domainOutOfRangeStdDevMultiplier,
): DomainDivergenceResult {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { isDivergent: false };
  }

  const flat = new Map<string, unknown>();
  flattenPayload(payload as Record<string, unknown>, '', flat);

  // Check numeric fields
  for (const profile of domain.numericFields) {
    const rawValue = flat.get(profile.fieldPath);
    if (rawValue === undefined) continue;
    if (typeof rawValue !== 'number') continue;

    const lower = profile.mean - stdDevMultiplier * profile.stdDev;
    const upper = profile.mean + stdDevMultiplier * profile.stdDev;

    if (rawValue < lower || rawValue > upper) {
      return {
        isDivergent: true,
        fieldPath: profile.fieldPath,
        changeKind: 'out-of-range',
        observedValue: rawValue,
      };
    }
  }

  // Check categorical fields (only non-open sets)
  for (const profile of domain.categoricalFields) {
    if (profile.isOpenSet) continue;
    const rawValue = flat.get(profile.fieldPath);
    if (rawValue === undefined) continue;
    const strValue = String(rawValue);
    if (!profile.observedValues.includes(strValue)) {
      return {
        isDivergent: true,
        fieldPath: profile.fieldPath,
        changeKind: 'unexpected-value',
        observedValue: strValue,
      };
    }
  }

  return { isDivergent: false };
}

function flattenPayload(obj: Record<string, unknown>, prefix: string, out: Map<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.set(path, value);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flattenPayload(value as Record<string, unknown>, path, out);
    }
  }
}
