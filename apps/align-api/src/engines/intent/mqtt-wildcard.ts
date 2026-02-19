/**
 * mqtt-wildcard.ts
 *
 * MQTT topic wildcard matching per MQTT specification:
 *   +  single-level wildcard — matches exactly one topic level
 *   #  multi-level wildcard  — matches zero or more levels; must be last character
 *
 * Examples:
 *   sensors/+/temperature matches sensors/room1/temperature
 *   fleet/#             matches fleet/agv1, fleet/agv1/state, fleet/agv1/battery
 *   exact/topic         matches exact/topic only
 *
 * Specificity is used for precedence: fewer wildcard characters = more specific.
 */

/**
 * Returns true if the given topic path matches the MQTT wildcard pattern.
 * Pure function — no side effects.
 */
export function mqttWildcardMatch(pattern: string, topic: string): boolean {
  const patternLevels = pattern.split('/');
  const topicLevels   = topic.split('/');

  for (let i = 0; i < patternLevels.length; i++) {
    const p = patternLevels[i];

    if (p === '#') {
      // Multi-level wildcard — matches everything remaining (including empty)
      return true;
    }

    if (i >= topicLevels.length) {
      // Pattern has more levels than topic and no # was hit
      return false;
    }

    if (p !== '+' && p !== topicLevels[i]) {
      // Literal mismatch
      return false;
    }

    // + matches any single level — continue
  }

  // Pattern exhausted — must have consumed all topic levels too
  return patternLevels.length === topicLevels.length;
}

/**
 * Specificity score for a topic_scope pattern.
 * Lower score = more specific (fewer wildcards).
 * Used for most-specific-wins precedence.
 */
export function patternSpecificity(pattern: string): number {
  let score = 0;
  for (const level of pattern.split('/')) {
    if (level === '#') score += 10;
    else if (level === '+') score += 1;
  }
  return score;
}
