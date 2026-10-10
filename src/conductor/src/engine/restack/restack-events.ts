import type { ConductorEvent } from '../../types/events.js';
import type { ChildId } from '../child-context.js';
import type { RestackRefusalReason } from './restack-types.js';

type RestackRefusedEvent = Extract<ConductorEvent, { type: 'restack_refused' }>;

/** The sole constructor for restack refusal occurrences on the event spine. */
export function emitRestackRefused({
  reason,
  child,
  detail,
}: {
  readonly reason: RestackRefusalReason;
  readonly child?: ChildId;
  readonly detail?: string;
}): RestackRefusedEvent {
  return {
    type: 'restack_refused',
    reason,
    ...(child === undefined ? {} : { child }),
    ...(detail === undefined ? {} : { detail }),
  };
}
