import { appendCloseoutEvent, type PipelineCloseoutEvent } from './closeout-events.js';

const CLOSEOUT_OBLIGATIONS = [
  'evaluator',
  'simplify',
  'architecture-diagram',
  'micro-retro',
  'memory',
  'summary',
] as const satisfies readonly PipelineCloseoutEvent['obligation'][];

function isCloseoutObligation(obligation: string): obligation is PipelineCloseoutEvent['obligation'] {
  return CLOSEOUT_OBLIGATIONS.includes(obligation as PipelineCloseoutEvent['obligation']);
}

export interface CloseoutEventDispatch {
  kind: 'closeout-event';
  obligation: string;
  startedAt: number;
  endedAt: number;
}

/** Parse `conduct-ts closeout-event <obligation> <started-at> <ended-at>`. */
export function detectCloseoutEventCommand(argv: string[]): CloseoutEventDispatch | null {
  if (argv[2] !== 'closeout-event') return null;

  return {
    kind: 'closeout-event',
    obligation: argv[3] ?? '',
    startedAt: Number(argv[4]),
    endedAt: Number(argv[5]),
  };
}

/** Append one pipeline-owned closeout event without starting the conductor. */
export async function dispatchCloseoutEventCommand(
  command: CloseoutEventDispatch,
  projectRoot: string = process.cwd(),
  now: () => number = Date.now,
  reportError: (message: string) => void = console.error,
): Promise<number> {
  if (!isCloseoutObligation(command.obligation)) {
    reportError(`closeout-event: obligation must be one of ${CLOSEOUT_OBLIGATIONS.join(', ')}`);
    return 1;
  }

  appendCloseoutEvent(projectRoot, {
    type: 'pipeline_closeout',
    obligation: command.obligation,
    startedAt: command.startedAt,
    endedAt: command.endedAt,
    ts: now(),
  });
  return 0;
}
