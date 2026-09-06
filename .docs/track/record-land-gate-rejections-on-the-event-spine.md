# Track: Record land-gate rejections on the event spine

Track: technical

Scope boundary: Small fix for #1628, approved by the operator on 2026-09-06 (delegated). Give every land-time rejection a stable gate identifier, add one `ConductorEvent` member for a land-gate rejection, and emit it from the spec-landing command's failure path onto the target repository's persisted event ledger. Historical backfill of past rejections, a precision report or dashboard, rejection recording for any other command, and any change to what the gates themselves accept or reject are outside this slice.

This is internal engine and observability tooling, not a product surface; acceptance criteria live in technical stories rather than a PRD.

The operator approved, on 2026-09-06 (delegated), recording every rejection — precondition failures as well as artifact-form failures — under one event with an enumerated gate identifier, rather than recording only the form gates. A single event with a closed gate vocabulary makes per-gate counts derivable without a second classification step, and an explicit unclassified bucket keeps the "every rejection is recorded" property literally true instead of silently dropping unexpected failures.

Event spine
  Channel?    yes — a record of land-time gate rejections that no consumer can see today
  Concern:    occurrence — a rejection happens at a point in time and is counted per period
  Verdict:    extend the union — one new `ConductorEvent` member, emitted through `ConductorEventEmitter` and written by the existing `EventPersister`
  Exception:  none — no sidecar file, no bespoke format, no new reader path

Scope check: A — consumer-facing; the spec-landing command and its gates ship in the engine and run in any repository that installs the harness, and no repo-only signal fires (no self-host, sandbox, integrity-suite, release-gate, or CI surface is touched). B — n/a (no new skill). C — provider-agnostic (no provider path, variable, or capability is involved). Registration: none beyond the event-catalogue documentation page, which is the canonical affected documentation for a new persisted event.

Verified foundation: `landSpec` in `src/conductor/src/engine/engineer/land-spec.ts` rejects through eighteen distinct `throw new Error` sites plus one `TargetPathMissingError`, all carrying prose messages with no machine-readable gate identifier; its coherence gate delegates to `runCoherenceGate` in `src/conductor/src/engine/engineer/coherence-validator.ts`, whose five throws surface through that one call. `landSpec`'s only caller is the `land` case of `dispatchEngineer` in `src/conductor/src/engine/engineer-cli.ts`, which catches the error, prints it with the retained worktree path, and returns exit code 1 — with no event emitter anywhere in the engineer command surface. `EVENT_SINKS` in `src/conductor/src/engine/event-sinks.ts` is a total record over `ConductorEvent['type']`, so a new union member mechanically forces its sink declaration, and `persistedEventTypes()` derives the `EventPersister` subscription from it. The `rewind` command in `src/conductor/src/engine/rewind.ts` already establishes the pattern this change copies: a one-shot command constructs a `ConductorEventEmitter`, attaches an `EventPersister` pointed at a repository-root `.pipeline/events.jsonl`, emits, and stops.
