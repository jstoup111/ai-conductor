import type { ProviderAttemptStartedEvent } from '../types/events.js';

/** Formats the provider identity at the instant an attempt begins. */
export function formatProviderStartLine(event: ProviderAttemptStartedEvent): string {
  const label = event.executionContext?.subject.kind === 'configured-member'
    ? `${event.executionContext.subject.parentGroup} / ${event.executionContext.subject.member}`
    : event.step;

  if (event.provider.kind === 'unknown') return `▸ ${label} provider unknown`;

  const model = typeof event.model === 'string' && event.model.trim()
    ? ` (${event.model.trim()})`
    : '';
  return `▸ ${label} on ${event.provider.id}${model}`;
}
