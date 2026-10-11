import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  appendCloseoutEvent,
  type PipelineCloseoutEvent,
  type PipelineCloseoutStartedEvent,
} from './closeout-events.js';

const CLOSEOUT_OBLIGATIONS = [
  'evaluator',
  'simplify',
  'architecture-diagram',
  'memory',
  'summary',
] as const satisfies readonly PipelineCloseoutEvent['obligation'][];

function isCloseoutObligation(obligation: string): obligation is PipelineCloseoutEvent['obligation'] {
  return CLOSEOUT_OBLIGATIONS.includes(obligation as PipelineCloseoutEvent['obligation']);
}

export interface CloseoutEventDispatch {
  kind: 'closeout-event';
  action: string;
  obligation: string;
  extra: string[];
}

/** Parse `ai-conductor closeout-event <start|end> <obligation>`. */
export function detectCloseoutEventCommand(argv: string[]): CloseoutEventDispatch | null {
  if (argv[2] !== 'closeout-event') return null;

  return {
    kind: 'closeout-event',
    action: argv[3] ?? '',
    obligation: argv[4] ?? '',
    extra: argv.slice(5),
  };
}

function usageError(reportError: (message: string) => void): number {
  reportError('closeout-event: expected "closeout-event start <obligation>" or "closeout-event end <obligation>"');
  return 1;
}

function latestOpenStart(projectRoot: string, obligation: PipelineCloseoutEvent['obligation']): PipelineCloseoutStartedEvent | undefined {
  const path = join(projectRoot, '.pipeline', 'pipeline-events.jsonl');
  if (!existsSync(path)) return undefined;

  let open: PipelineCloseoutStartedEvent | undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    try {
      const record: unknown = JSON.parse(line);
      if (typeof record !== 'object' || record === null) continue;
      const event = record as { type?: unknown; obligation?: unknown; ts?: unknown };
      if (event.obligation !== obligation) continue;
      if (event.type === 'pipeline_closeout_started' && typeof event.ts === 'number') {
        open = { type: 'pipeline_closeout_started', obligation, ts: event.ts };
      } else if (event.type === 'pipeline_closeout') {
        open = undefined;
      }
    } catch {
      // A sibling process may have left an unrelated malformed record behind.
    }
  }
  return open;
}

/** Append one pipeline-owned closeout event without starting the conductor. */
export async function dispatchCloseoutEventCommand(
  command: CloseoutEventDispatch,
  projectRoot: string = process.cwd(),
  now: () => number = Date.now,
  reportError: (message: string) => void = console.error,
): Promise<number> {
  if ((command.action !== 'start' && command.action !== 'end') || command.extra.length > 0) {
    return usageError(reportError);
  }

  if (!isCloseoutObligation(command.obligation)) {
    reportError(`closeout-event: obligation must be one of ${CLOSEOUT_OBLIGATIONS.join(', ')}`);
    return 1;
  }

  if (command.action === 'start') {
    appendCloseoutEvent(projectRoot, {
      type: 'pipeline_closeout_started',
      obligation: command.obligation,
      ts: now(),
    });
    return 0;
  }

  const start = latestOpenStart(projectRoot, command.obligation);
  if (start === undefined) {
    reportError(`closeout-event: no open start for ${command.obligation}`);
    return 1;
  }

  const endedAt = now();
  if (endedAt <= start.ts) {
    reportError(`closeout-event: non-positive elapsed time for ${command.obligation}`);
    return 1;
  }

  appendCloseoutEvent(projectRoot, {
    type: 'pipeline_closeout',
    obligation: command.obligation,
    startedAt: start.ts,
    endedAt,
    ts: endedAt,
  });
  return 0;
}
