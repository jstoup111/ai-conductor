// Covers: task:2
import { expect, it } from 'vitest';
import { parseChildId } from '../../src/engine/child-context.js';
import type { ConductorEvent } from '../../src/types/events.js';

const child = parseChildId(1)!;

const stackEvents = [
  { type: 'stack_member_published', child, pr: 101 },
  { type: 'stack_member_redrafted', child, pr: 500 },
  { type: 'stack_assembled', prs: [101, 303, 500] },
  { type: 'stack_member_lifecycle', child, pr: 101, state: 'merged', eventId: 'lifecycle-101' },
  { type: 'stack_members_unreachable', child, pr: 101 },
  { type: 'stack_tip_diverged', prs: [101, 303] },
] satisfies ConductorEvent[];

it('declares stack events with PR numbers and child identity only for one member', () => {
  expect(stackEvents).toHaveLength(6);
});
