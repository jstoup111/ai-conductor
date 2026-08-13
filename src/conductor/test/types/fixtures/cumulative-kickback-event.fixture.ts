import type { ConductorEvent } from '../../../src/types/events.js';

type KickbackEvent = Extract<ConductorEvent, { type: 'kickback' }>;
type CountOnlyKickback = Pick<KickbackEvent, 'count'>;

const readCount = (event: CountOnlyKickback): number => event.count;
const event: KickbackEvent = {
  type: 'kickback',
  from: 'build',
  to: 'build_review',
  count: 3,
  cumulativeCount: 7,
};

export const count = readCount(event);
