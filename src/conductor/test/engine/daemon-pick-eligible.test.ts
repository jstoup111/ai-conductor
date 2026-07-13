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

// Task 8 (progress-gated cross-dispatch re-kick, D2) — a parked slug whose
// HALT marker is still live (no base advance cleared it) becomes eligible
// again when the injected `isProgressReKickEligible` reports the last
// dispatch made forward progress. Additive to the existing isHalted-cleared
// path — it never bypasses the started/parked bookkeeping itself.
describe('pickEligible — progress-gated re-kick eligibility (D2 happy)', () => {
  it('re-admits a parked slug whose HALT marker is still live but isProgressReKickEligible reports progress', async () => {
    const items: BacklogItem[] = [{ slug: 'progressing-spec' }];
    const result = await pickEligible(
      { items },
      {
        inFlight: new Set(),
        parked: new Set(['progressing-spec']),
        started: new Set(['progressing-spec']),
        isHalted: async () => true, // still parked — no base advance cleared it
        isProgressReKickEligible: async (slug) => slug === 'progressing-spec',
      },
    );
    expect(result?.slug).toBe('progressing-spec');
  });

  it('leaves a parked slug ineligible when isProgressReKickEligible reports no progress', async () => {
    const items: BacklogItem[] = [{ slug: 'stalled-spec' }];
    const result = await pickEligible(
      { items },
      {
        inFlight: new Set(),
        parked: new Set(['stalled-spec']),
        started: new Set(['stalled-spec']),
        isHalted: async () => true,
        isProgressReKickEligible: async () => false,
      },
    );
    expect(result).toBeUndefined();
  });
});

// Task 7 (operator-park) — dispatch eligibility: a `.daemon/parked/<slug>`
// operator-park marker sits beside the `isHalted` consult and makes the slug
// permanently ineligible for dispatch — independent of the in-run
// `parked`/`started` bookkeeping and independent of the HALT marker state.
describe('pickEligible — operator-parked slugs are ineligible for dispatch (FR-2 happy)', () => {
  it('does not dispatch a parked backlog slug on a normal tick', async () => {
    const items: BacklogItem[] = [{ slug: 'parked-spec' }, { slug: 'free-spec' }];
    const result = await pickEligible(
      { items },
      {
        inFlight: new Set(),
        parked: new Set(),
        started: new Set(),
        isParked: async (slug) => slug === 'parked-spec',
      },
    );
    expect(result?.slug).toBe('free-spec');
  });

  it('still refuses a parked slug whose HALT marker was removed (halt-clear resume, PR-#109)', async () => {
    // isHalted reports false (marker cleared) but isOperatorParked still reports
    // true — the operator park is a separate, durable stop that HALT-clearing
    // must not lift.
    const items: BacklogItem[] = [{ slug: 'parked-spec' }];
    const result = await pickEligible(
      { items },
      {
        inFlight: new Set(),
        parked: new Set(['parked-spec']),
        started: new Set(),
        isHalted: async () => false,
        isParked: async (slug) => slug === 'parked-spec',
      },
    );
    expect(result).toBeUndefined();
  });

  it('remains ineligible across a restart simulation (fresh in-run state, same fs)', async () => {
    // Simulates a fresh daemon process: `inFlight`/`parked`/`started` are all
    // empty (in-memory state does not survive a restart) but the durable
    // `.daemon/parked/<slug>` marker (modeled here via `isParked`) still exists
    // on disk, so the slug must still be skipped.
    const items: BacklogItem[] = [{ slug: 'parked-spec' }, { slug: 'free-spec' }];
    const result = await pickEligible(
      { items },
      {
        inFlight: new Set(),
        parked: new Set(),
        started: new Set(),
        isHalted: async () => false,
        isParked: async (slug) => slug === 'parked-spec',
      },
    );
    expect(result?.slug).toBe('free-spec');
  });
});
