# Complexity: Re-kick sentinel can strand an active feature outside recovery

Tier: S

## Rationale

Approach B is an observability-only change to two existing surfaces:

- `daemon-backlog.ts` — the per-pass blocked-spec scan already writes `.daemon/blocked.json` with a
  `missing-coherence` reason and a remedy. This change adds detection of a stranded
  `.pipeline/REKICK` sentinel to that same scan and carries it on the existing read model.
- `daemon-dashboard.ts` — the existing bucket precedence chain gains no new bucket kind; a
  sentinel-carrying worktree that discovery has named as blocked stops being reported as
  IN-PROGRESS and is rendered with its blocking gate.

Signals against a higher tier: no new data model, no new integration or third-party boundary, no
auth surface, no state machine, no new recovery semantics (nothing is cleared, reaped, dispatched,
or parked by this change), and no schema migration — `blocked.json` already carries
`schemaVersion: 1` and is rewritten wholesale each pass. Story count is small (happy path plus the
negative paths for an unreadable sentinel, a parked slug, and a processed slug).

Signal considered and discounted: the change touches the operator-visible bucket precedence in
`daemon-dashboard.ts`. That precedence is a pure function over already-collected inputs with
existing unit coverage, so the risk is contained to rendering rather than to dispatch or recovery.

The two deferred alternatives — a sentinel-lifecycle recovery sweep and retiring the file sentinel
in favour of spine-derived state — are explicitly out of scope here and would each carry their own,
higher, tier.
