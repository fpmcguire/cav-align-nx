/**
 * topic-utils.ts
 *
 * MQTT topic filter utilities.
 * These are pure functions with no dependencies — safe in any context.
 *
 * Ported from agv-fleet-management-sim with full test coverage expected.
 */

/**
 * Returns true if `topic` matches the MQTT `filter`.
 * Supports:
 *   + : single-level wildcard (matches exactly one segment)
 *   # : multi-level wildcard (matches zero or more trailing segments)
 *
 * Examples:
 *   topicMatches('vda5050/+/+/state', 'vda5050/KUKA/V01/state')  → true
 *   topicMatches('vda5050/#', 'vda5050/KUKA/V01/state')           → true
 *   topicMatches('vda5050/+/+/state', 'vda5050/KUKA/V01/order')  → false
 */
export function topicMatches(filter: string, topic: string): boolean {
  if (filter === topic) return true;

  const filterParts = filter.split('/');
  const topicParts = topic.split('/');

  for (let i = 0; i < filterParts.length; i++) {
    if (filterParts[i] === '#') return true;
    if (topicParts[i] == null) return false;
    if (filterParts[i] === '+') continue;
    if (filterParts[i] !== topicParts[i]) return false;
  }

  return filterParts.length === topicParts.length;
}

/**
 * Returns true if a topic filter string contains wildcards.
 */
export function isWildcardFilter(filter: string): boolean {
  return filter.includes('+') || filter.includes('#');
}

/**
 * Returns the top-level namespace segment from a topic path.
 * e.g. 'vda5050/KUKA/V01/state' → 'vda5050'
 */
export function topicNamespace(topic: string): string {
  return topic.split('/')[0] ?? topic;
}
