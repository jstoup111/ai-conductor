/**
 * Formats the manual-test agent's final message for inclusion in a no-results
 * retry reason. Keep the excerpt bounded so provider output cannot make a
 * durable halt or event excessively large.
 */
export function manualTestBlockerClause(dispatchOutput: string | undefined): string {
  const normalized = dispatchOutput?.trim().replace(/\s+/g, ' ');
  if (!normalized) return '; the agent gave no final message';

  const excerpt = normalized.length > 600 ? `…${normalized.slice(-600)}` : normalized;
  return `; agent reported: "${excerpt}"`;
}
