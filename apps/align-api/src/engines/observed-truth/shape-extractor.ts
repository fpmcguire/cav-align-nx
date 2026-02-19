/**
 * shape-extractor.ts
 *
 * Extracts the structural shape of a JSON payload using recursive traversal.
 * Builds and aggregates ObservedShape across multiple messages.
 */

import type { JsonFieldType, ShapeField, ObservedShape } from '@cav-align/core';
import { DEFAULT_ALIGN_CONFIG } from '@cav-align/core';

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

/** Infer the JsonFieldType of a runtime value. */
function inferType(value: unknown): JsonFieldType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':  return 'string';
    case 'number':  return 'number';
    case 'boolean': return 'boolean';
    case 'object':  return 'object';
    default:        return 'string'; // fallback
  }
}

interface FieldObservation {
  path: string;
  types: Map<JsonFieldType, number>; // type → count
  presenceCount: number;
  totalMessages: number;
  children: Map<string, FieldObservation>;
}

function getOrCreateObservation(
  map: Map<string, FieldObservation>,
  path: string,
  totalMessages: number,
): FieldObservation {
  let obs = map.get(path);
  if (!obs) {
    obs = {
      path,
      types: new Map(),
      presenceCount: 0,
      totalMessages,
      children: new Map(),
    };
    map.set(path, obs);
  }
  return obs;
}

/** Recursive traversal — populates the observations map. */
function traversePayload(
  obj: Record<string, unknown>,
  parentPath: string,
  depth: number,
  maxDepth: number,
  observations: Map<string, FieldObservation>,
  totalMessages: number,
): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = parentPath ? `${parentPath}.${key}` : key;
    const obs = getOrCreateObservation(observations, path, totalMessages);

    obs.totalMessages = totalMessages;
    obs.presenceCount++;

    const type = inferType(value);
    obs.types.set(type, (obs.types.get(type) ?? 0) + 1);

    // Recurse into objects (not arrays — track as opaque)
    if (type === 'object' && depth < maxDepth && value !== null) {
      traversePayload(
        value as Record<string, unknown>,
        path,
        depth + 1,
        maxDepth,
        obs.children,
        totalMessages,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// ShapeAggregator
// ---------------------------------------------------------------------------

/**
 * Aggregates shape observations across multiple messages.
 * Call `addSample()` for each message, then `buildShape()` when done.
 */
export class ShapeAggregator {
  private observations = new Map<string, FieldObservation>();
  private messageCount = 0;
  private readonly maxDepth: number;
  private readonly requiredPresenceThreshold: number;

  constructor(
    maxDepth = DEFAULT_ALIGN_CONFIG.inference.shapeMaxDepth,
    requiredPresenceThreshold = DEFAULT_ALIGN_CONFIG.inference.shapeRequiredPresenceThreshold,
  ) {
    this.maxDepth = maxDepth;
    this.requiredPresenceThreshold = requiredPresenceThreshold;
  }

  addSample(payload: unknown): void {
    this.messageCount++;

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return; // Non-object root — nothing to extract
    }

    traversePayload(
      payload as Record<string, unknown>,
      '',
      1,
      this.maxDepth,
      this.observations,
      this.messageCount,
    );
  }

  buildShape(sampleSize?: number): ObservedShape {
    const n = sampleSize ?? this.messageCount;
    const topLevelFields = this.buildShapeFields(this.observations, n);
    const maxDepth = this.computeMaxDepth(this.observations);

    return {
      topLevelFields,
      maxDepthObserved: maxDepth,
      sampleSize: n,
      inferredAt: new Date().toISOString(),
    };
  }

  private buildShapeFields(
    observations: Map<string, FieldObservation>,
    totalMessages: number,
  ): ShapeField[] {
    const fields: ShapeField[] = [];

    for (const obs of observations.values()) {
      const presenceRate = obs.presenceCount / Math.max(totalMessages, 1);
      const dominantType = this.getDominantType(obs.types);
      const observedType: JsonFieldType =
        obs.types.size > 1 ? 'mixed' : dominantType;

      const childFields =
        obs.children.size > 0
          ? this.buildShapeFields(obs.children, obs.presenceCount)
          : undefined;

      fields.push({
        path: obs.path,
        observedType,
        presenceRate,
        isRequired: presenceRate >= this.requiredPresenceThreshold,
        childFields,
      });
    }

    return fields;
  }

  private getDominantType(types: Map<JsonFieldType, number>): JsonFieldType {
    let max = 0;
    let dominant: JsonFieldType = 'null';
    for (const [type, count] of types) {
      if (count > max) {
        max = count;
        dominant = type;
      }
    }
    return dominant;
  }

  private computeMaxDepth(
    observations: Map<string, FieldObservation>,
    current = 1,
  ): number {
    if (observations.size === 0) return current - 1;
    let max = current;
    for (const obs of observations.values()) {
      if (obs.children.size > 0) {
        max = Math.max(max, this.computeMaxDepth(obs.children, current + 1));
      }
    }
    return max;
  }
}

// ---------------------------------------------------------------------------
// Shape comparison (for divergence detection)
// ---------------------------------------------------------------------------

export interface ShapeComparisonResult {
  hasChanges: boolean;
  addedFields: string[];
  removedFields: string[];
  typeChanges: Array<{
    path: string;
    expectedType: JsonFieldType;
    observedType: JsonFieldType;
  }>;
}

/** Compare a current payload's shape against established OT shape. */
export function compareShapes(
  currentPayload: unknown,
  establishedFields: ShapeField[],
): ShapeComparisonResult {
  if (typeof currentPayload !== 'object' || currentPayload === null || Array.isArray(currentPayload)) {
    return { hasChanges: false, addedFields: [], removedFields: [], typeChanges: [] };
  }

  const current = new Map<string, JsonFieldType>();
  extractFlatPaths(currentPayload as Record<string, unknown>, '', current, 1, DEFAULT_ALIGN_CONFIG.inference.shapeMaxDepth);

  const established = new Map<string, JsonFieldType>();
  flattenShapeFields(establishedFields, established);

  const addedFields: string[] = [];
  const removedFields: string[] = [];
  const typeChanges: ShapeComparisonResult['typeChanges'] = [];

  // Fields in current but not in established
  for (const [path, type] of current) {
    if (!established.has(path)) {
      addedFields.push(path);
    } else {
      const estType = established.get(path)!;
      if (estType !== 'mixed' && type !== estType) {
        typeChanges.push({ path, expectedType: estType, observedType: type });
      }
    }
  }

  // Required fields in established but missing from current
  for (const [path] of established) {
    if (!current.has(path)) {
      const sf = findShapeField(establishedFields, path);
      if (sf?.isRequired) {
        removedFields.push(path);
      }
    }
  }

  return {
    hasChanges: addedFields.length > 0 || removedFields.length > 0 || typeChanges.length > 0,
    addedFields,
    removedFields,
    typeChanges,
  };
}

function extractFlatPaths(
  obj: Record<string, unknown>,
  prefix: string,
  out: Map<string, JsonFieldType>,
  depth: number,
  maxDepth: number,
): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const type = inferType(value);
    out.set(path, type);
    if (type === 'object' && depth < maxDepth && value !== null) {
      extractFlatPaths(value as Record<string, unknown>, path, out, depth + 1, maxDepth);
    }
  }
}

function flattenShapeFields(fields: ShapeField[], out: Map<string, JsonFieldType>): void {
  for (const f of fields) {
    out.set(f.path, f.observedType);
    if (f.childFields) {
      flattenShapeFields(f.childFields, out);
    }
  }
}

function findShapeField(fields: ShapeField[], path: string): ShapeField | undefined {
  for (const f of fields) {
    if (f.path === path) return f;
    if (f.childFields) {
      const found = findShapeField(f.childFields, path);
      if (found) return found;
    }
  }
  return undefined;
}
