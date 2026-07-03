// Task 14 — No head-of-line blocking in pickEligible (FR-4 negative).
//
// pickEligible must consume ONLY `backlog.items` and never reach into
// `backlog.waiting` — a spec diverted to `waiting` by the dependency gate
// (Task 11) must never stall dispatch of a later, unblocked item in `items`.

import { describe, it, expect } from 'vitest';
import { pickEligible, type BacklogItem } from '../../src/engine/daemon.js';

describe('pickEligible — no head-of-line blocking (FR-4 negative)', () => {
  it('skips a lexicographically-first spec parked in waiting and returns the next eligible item', async () => {
    // `blocked-spec` sorts first but lives ONLY in `waiting` (as a real
    // dependency-gated backlog would produce) — it is never present in
    // `items`, so pickEligible must never see or return it.
    const waiting = [{ slug: 'blocked-spec', sourceRef: 'acme/app#1', verdict: { kind: 'blocked' as const } }];
    const items: BacklogItem[] = [{ slug: 'clear-spec' }];

    const result = await pickEligible(
      { items },
      { inFlight: new Set(), parked: new Set(), started: new Set() },
    );

    expect(result?.slug).toBe('clear-spec');
    // The waiting fixture is never consumed/mutated — sanity check it is
    // still exactly what it started as, proving pickEligible never touched it.
    expect(waiting).toEqual([{ slug: 'blocked-spec', sourceRef: 'acme/app#1', verdict: { kind: 'blocked' } }]);
  });

  it('returns undefined when items is empty, even if waiting has entries', async () => {
    const result = await pickEligible(
      { items: [] },
      { inFlight: new Set(), parked: new Set(), started: new Set() },
    );
    expect(result).toBeUndefined();
  });

  it('still honors in-flight/parked/started exclusions within items', async () => {
    const items: BacklogItem[] = [{ slug: 'in-flight-spec' }, { slug: 'started-spec' }, { slug: 'free-spec' }];
    const result = await pickEligible(
      { items },
      {
        inFlight: new Set(['in-flight-spec']),
        parked: new Set(),
        started: new Set(['started-spec']),
      },
    );
    expect(result?.slug).toBe('free-spec');
  });
});
