import { createPriorityResolver } from './backlog-priority.js';
import { createBlockerResolver } from './blocker-resolver.js';
import type { IntakeEventEmitter } from './intake-backend-composite.js';
import { createOrderingSource } from './ordering-source.js';
import type { GhRunner } from './tracker-client.js';

/** Shared ordering reads for one daemon process, with per-scan blocker state. */
export function createDaemonOrderingReaders(deps: {
  run: GhRunner;
  cwd: string;
  events: IntakeEventEmitter;
  log: (message: string) => void;
}) {
  const source = createOrderingSource({ run: deps.run, cwd: deps.cwd, events: deps.events });
  return {
    priorityResolver: createPriorityResolver(source, deps.log),
    makeResolver: () => createBlockerResolver({ source }),
  };
}
