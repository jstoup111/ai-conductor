# Track: Automatic park outcome writes no park marker

Track: technical

Daemon engine internals (`daemon-runner.ts` error boundary, `park-marker.ts`): the automatic
park path never writes `.daemon/parked/<slug>`, so an erroring feature stays dispatchable while
its HALT falsely claims it was parked. No user-facing product surface and no new product
requirements — acceptance criteria live directly in the stories.

## Selected approach

**B — make "parked" un-claimable unless it is true.** Collapse the park decision, the marker
write, and the HALT's first line into one boundary primitive: callers declare park intent, the
primitive writes `.daemon/parked/<slug>` via the existing `writeAutoPark`, and the HALT note is
*derived* from what was actually written. A non-park error termination renders an honest
"errored — will re-dispatch" note and writes no marker.

### Why the alternatives were rejected

- **A (route the triage `park` branch through `writeAutoPark`)** — the filer's hypothesis, and
  correct as far as it goes, but it repairs one of the four `writeErrorHalt` call sites
  (`daemon-runner.ts:356, 484, 536, 556`). The other three keep emitting
  `feature errored — parked for human inspection` while the feature remains dispatchable, so the
  false-claim class survives and can regrow at the next new error path.
- **C (make backlog eligibility honor `.pipeline/HALT`)** — the HALT lives inside the worktree,
  which this repo treats as disposable (CLAUDE.md, Daemon Operations Safety rule 3). Recreating a
  worktree would silently un-suppress the loop. It also conflates halt with park, leaves
  reconciliation reporting `parked=0`, and fails the "marker exists on disk" outcome outright.

## Discovery findings (verified against source in this worktree)

- `daemon-runner.ts:353-362` — the `triageOutcome.kind === 'park'` branch logs, calls
  `writeErrorHalt`, tears down, and returns `status: 'error'`. It never calls `writeAutoPark`
  (`park-marker.ts:231`), which is the writer `conduct-ts daemon park` uses.
- `daemon-backlog.ts:846` gates dispatch eligibility on the park marker alone; a `.pipeline/HALT`
  does not block re-dispatch. This is the mechanism of the infinite loop.
- `park-reconciliation.ts:479` derives its `parked` count from markers observed during the sweep,
  so `parked=0` is a downstream symptom — writing the marker satisfies that outcome with no
  separate change.
- `writeErrorHalt` hardcodes the "parked for human inspection" line at `daemon-runner.ts:585` and
  is reached from four sites, only one of which is a triage park.

## Assumptions carried into stories

- Only the triage `park` outcome writes a marker. The false-ship guard (`:484`), the
  no-DONE/no-HALT termination (`:536`), and the catch-all throw (`:556`) get honest wording and
  **no** marker, preserving the stated outcome that a feature which errors but is not meant to be
  parked still dispatches on the next scan.
- The catch-all at `:556` also receives a `SetupFailureError` when daemon mode has no triage
  handler wired. To satisfy the "no more than one automatic fix-session per unresolved setup
  failure" outcome, that specific case must park too. Confidence this gap is reachable in
  production: ~70% (inferred from the `deps.daemon && deps.runSetupTriage` guard at `:339-342`,
  not observed in a log).
