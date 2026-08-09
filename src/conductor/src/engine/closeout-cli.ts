import { appendCloseoutEvent, type PipelineCloseoutEvent } from './closeout-events.js';

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
): Promise<number> {
  appendCloseoutEvent(projectRoot, {
    type: 'pipeline_closeout',
    obligation: command.obligation as PipelineCloseoutEvent['obligation'],
    startedAt: command.startedAt,
    endedAt: command.endedAt,
    ts: now(),
  });
  return 0;
}
