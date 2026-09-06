# Track: Render kickback and BUILD re-entry counts in the run report

Track: technical

Scope boundary: Small fix for #2252, approved by the operator on 2026-09-06 (delegated). Add one kickback section to the existing `--report` renderer, attributed per source gate, with an explicit statement when a feature never kicked back, and keep the report a pure read of the persisted event ledger. Halt tables, cumulative build-review lap accounting across progress resets, the `kpi` and cost-rollup surfaces, the engineer-loop signal path, and any change to how kickbacks are emitted or persisted are outside this slice.

This is internal diagnostic tooling for harness operators; acceptance criteria live in technical stories rather than a PRD.

The operator approved counting kickback occurrences per source gate over reading the per-event running `count` field on 2026-09-06 (delegated). The running counter resets when a gate's progress is reset — which is why a separate cumulative field exists for one gate only — so occurrence counts are the figure that answers "how many times was BUILD re-opened" for every gate uniformly.

Scope check: A — harness-repo-only (the `--report` renderer is an engine surface that exists only in this repository); B — n/a (no new skill); C — provider-agnostic (no provider, model, or host behavior is involved). No catalog registration is required.

Event spine: Channel? no — the change adds a reader over events already on the bus, not a new way to observe anything. Concern: occurrence, already carried by the persisted `kickback` variant. Verdict: no spine change; the existing union, emitter, and persister are untouched. Exception: none required.

Verified foundation: `renderReport` composes exactly five sections and none of them reads kickbacks; `aggregateKickbacks` already parses the persisted variant into `{from, to, count, evidence?, kickbackOutcome?}` and is consumed only by the engineer-store signal path; the `kickback` variant is registered with `persist: true` in the event-sink table, so the data the section needs is already in the ledger the report reads; the `--report` branch of the CLI calls `renderReport` and nothing else.
