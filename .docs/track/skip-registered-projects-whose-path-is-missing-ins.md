# Track: Skip registered projects whose path is missing

Track: technical

Scope boundary: Small fix for #1131, approved by the operator on 2026-09-06 (delegated). The intake
poll recognises a registered project whose directory is absent, skips it before any GitHub command
is attempted, and reports it once per episode as a path-liveness problem. Registry repair, automatic
de-registration of dead paths, a durable health record for registrations, and any change to the
notifier status file are outside this slice.

This is internal daemon/intake tooling with no product requirement; acceptance criteria live in
technical stories rather than a PRD.

The operator-delegated decision on 2026-09-06 was to keep the operator-facing surface on the intake
adapter's existing injected log sink — the same sink the misleading `spawn gh ENOENT` line already
uses — rather than add the skipped registration to the notifier status file. Adding a field to an
artifact the loop already writes is the parallel-channel shape the event-spine rule names explicitly,
and it would put the signal where none of the existing log consumers look.

Scope check: A — harness-repo-only (the intake registry and its brain-pane poll exist only in this
repository's daemon); B — n/a (no new skill); C — provider-agnostic (no provider path, variable, or
capability is involved). No catalog registration is required.

Event spine: Channel? no — the change corrects the condition and wording of a diagnostic already
emitted on the adapter's injected log sink, and adds no watcher, sidecar file, ledger, stamped
timestamp, or out-of-band signal. Concern: occurrence, already carried. Verdict: no new channel,
no ADR required. Exception: none needed.

Verified foundation: `poll()` in `src/conductor/src/engine/engineer/intake/github-issues.ts` iterates
every registered repo and calls `tracker.listAssignedIssues(ghRepo, repo.path)` with no liveness check
on `repo.path`; `makeProductionGh` in `src/conductor/src/engine/tracker-client.ts` passes that path as
`execFile`'s `cwd`, which is what turns a deleted directory into `spawn gh ENOENT`, and `poll()`'s
catch then reports it through the `github-issues: poll failed for …` line. The same module already
imports `existsSync` and already existsSync-checks every candidate directory in `resolveReportCwd`,
so the liveness test is an established local pattern rather than a new dependency. `createRegistryReader`
in `src/conductor/src/engine/registry.ts` returns records verbatim and has no liveness notion of its own.
