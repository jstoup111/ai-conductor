import type { ConductorEvent } from '../../types/events.js';
import type { TranscriptRetentionOutcome } from './transcript-retention.js';

type TranscriptTerminalEvent = Extract<ConductorEvent,
  { type: 'step_completed' | 'step_failed' | 'step_interrupted' | 'step_refused' }>;

/** Translate a terminal lifecycle event into its transcript retention policy. */
export function transcriptTerminalOutcome(event: TranscriptTerminalEvent): TranscriptRetentionOutcome {
  switch (event.type) {
    case 'step_completed': return 'succeeded-with-progress';
    case 'step_failed': return 'failed';
    // An interrupted dispatch has no success verdict. Keep its evidence just
    // like every other non-success terminal outcome.
    case 'step_interrupted': return 'failed';
    case 'step_refused': return 'needs-human';
  }
  return assertNeverTranscriptTerminal(event);
}

function assertNeverTranscriptTerminal(value: never): never {
  throw new Error(`Unhandled transcript terminal event: ${JSON.stringify(value)}`);
}
