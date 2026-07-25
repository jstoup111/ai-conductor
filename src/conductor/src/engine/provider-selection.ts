import type { ProviderSelection } from '../types/config.js';

export function normalizeProviderSelection(
  selection: ProviderSelection | undefined,
): string[] {
  if (selection === undefined) return ['claude'];
  return Array.isArray(selection) ? [...selection] : [selection];
}
