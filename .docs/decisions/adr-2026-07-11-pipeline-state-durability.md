---
title: .pipeline run-state durability — defense-in-depth, fail-loud-not-crash
date: 2026-07-11
status: APPROVED
tags: [conductor, pipeline-state, resilience, self-host, ai-conductor-549]
---

# ADR: `.pipeline` run-state durability — defense-in-depth, fail-loud-not-crash

## Status

APPROVED

## Context

ai-conductor#549: during a harness self-build the finish step failed its completion
gate, the daemon kicked back finish→build, the re-dispatched build session committed
real work, and then the conductor **crashed** with
`ENOENT: open '<worktree>/.pipeline/session-created'` and halted. The entire
`.pipeline/` run-state (`conduct-state.json`, `task-status.json`, `task-evidence.json`,
`gates/*`, session hooks) was destroyed mid-loop; the post-mortem found only
`audit-trail/` and the `HALT` file surviving.

Two facts were verified against source and incident forensics:

1. **The crash is an unguarded WRITE.** `StepRunner` persists the session marker via
   `writeFile(join(pipelineDir,'session-created'),'1')` at
   `src/conductor/src/engine/step-runners.ts:423` (interactive) and `:498` (autonomous),
   plus the sibling `conduct-session-id` write. When the parent `.pipeline/` directory
   is absent, this `open`-for-write throws `ENOENT`, which bubbles out of the step runner
   and out of `Conductor.run()` as an unhandled error. *(verified — the error string is
   exactly `open '.../session-created'`, an fs write path.)*

2. **The crash handler loses in-memory state to an ordering bug.** `Conductor.run()`'s
   outer catch (`conductor.ts:3211-3226`) runs, in order:
   `writeState(this.stateFilePath, state).catch(()=>{})` → `mkdir('.pipeline',{recursive})`
   → `writeFile(LOOP_HALT_MARKER)`. When the `.pipeline` root is gone, the **state flush
   runs before the mkdir**, so it ENOENTs and is swallowed by its `.catch`; only the
   subsequent HALT write (after mkdir) survives. This is precisely why `conduct-state.json`
   was destroyed but `HALT` survived, and why recovery needed an operator hand-rebuild.
   *(verified — read at conductor.ts:3214-3219.)*

The actual **deleter** of `.pipeline/` is not yet proven. The leading candidate is the
`mutation-gate-probe` test suite, which creates and `rm -rf`s temporary `.pipeline`
directories and was running in the build session; commit `9209d7d2`
("harden mutation-gate-probe against host-load flake with retry and diagnostics") is
adjacent, and a test resolving/cleaning the **real** worktree path under host load fits
the timing. Confidence ~60% (inferred). Pinning it is outcome #1 of the issue and is
handed to BUILD as a research + regression-test task; **no decision in this ADR depends
on which actor deleted the directory** — the defenses below hold regardless.

All other `.pipeline` actors were audited and found correctly scoped:
`sweepStaleReviewArtifacts` (globbed artifacts only), `clearStaleMarker`
(`build-step-active` only), `resetSession` (2 marker files, guarded), the daemon-cli
pre-run sweep (`daemon-cli.ts:621-627`, 2 files, guarded), and the self-build sandbox
teardown (`/tmp` configDir only). None removes the `.pipeline` root.

## Decision

Adopt a **defense-in-depth, fail-loud-but-never-crash** stance for `.pipeline` run-state.
Three coordinated guarantees, all required together (per the issue's explicit demand for
both root cause and defensive degradation):

### D1 — Bookkeeping writes/reads never crash the conductor (defense-in-depth)

The conductor MUST NOT die on a missing `.pipeline` bookkeeping file. Concretely:

- **Ensure-dir at the known write choke points.** Before persisting `session-created` /
  `conduct-session-id` (step-runners.ts:423, :498) and in `resetSession`, ensure the
  `.pipeline` root exists (`mkdir` recursive) so the marker write cannot ENOENT. This is a
  bounded set of writes on one directory — not a blanket try/catch sprinkled across the
  codebase.
- **Reorder the crash handler** (`conductor.ts:3214-3219`) to `mkdir('.pipeline')` **before**
  `writeState(stateFilePath)`, so a dir-wipe crash still flushes the in-memory
  `conduct-state.json` from memory instead of silently dropping it. This alone would have
  reduced #549 from an operator hand-rebuild to an automatic state recovery.
- **Reads degrade, never throw.** `.pipeline` bookkeeping reads at check sites use
  existence-guarded access (the `fileExists`/`access` pattern already used at
  step-runners.ts:353, :547 and in `SessionManager`) — never a bare `readFile`/`open` that
  can ENOENT-crash. Audit confirms the current read sites are already guarded; the rule is
  codified so new reads stay guarded.

### D2 — Every cleanup is scoped to its own artifacts, never the shared root (real-bug class)

No cleanup that runs at a finish-failure kickback, a session teardown, or a test teardown
may remove or `rm -rf` the shared `.pipeline` **root**; it may only remove the specific
files/subpaths it owns. This is the fix for the *actual* bug class (an unscoped delete),
of which the `mutation-gate-probe` temp-dir cleanup is the leading instance. Test helpers
that fabricate a temp `.pipeline` MUST anchor deletion to an `mkdtemp`-created path and
MUST NOT derive a path that can resolve to a live worktree's `.pipeline` (e.g. via a
relative path under host-load-shifted cwd).

### D3 — A missing root mid-run is a LOUD anomaly, not a silent recreate

Recreating a bookkeeping marker (D1) restores liveness but MUST NOT masquerade as normal
operation. When a write choke point finds the `.pipeline` root **absent mid-run** (i.e.
after the run has already started — not the legitimate first-provision or post-ship
teardown), it recreates the directory to avoid the crash **and** emits a loud,
greppable log line (`WARNING: .pipeline root was missing mid-run at <site> — recreated;
run-state may be degraded`). The engine does not silently proceed on empty state and does
not silently swallow the anomaly: the existing fail-closed gates (evidence gate, completion
checks) already refuse to pass on absent state, so the loud recreate + fail-closed gates
together surface the fault without inventing a new bespoke halt path. The commit-trailer
evidence redundancy (deterministic-attribution design) remains the durable recovery layer
for evidence stamps.

### Rejected alternatives

- **`mkdir -p` before every write, no logging (tension 1).** Rejected: silently masks a
  genuine "provisioned at the wrong path / never provisioned" fault and lets the run proceed
  on empty state — exactly the invisible-corruption failure the deterministic-first
  principle warns against. D3's loud-recreate keeps the liveness benefit without the silence.
- **Catch-and-log only, no recreate.** Rejected: leaves the very next bookkeeping write to
  fail again; liveness is not restored. D1's ensure-dir is needed.
- **Guard the write but NOT fix the deleter (Guard 1 as the whole fix).** Rejected: a
  defensive write that hides an unscoped `rm -rf` is a band-aid that would let the deletion
  regress invisibly and silently corrupt future runs. The issue demands both; D1 and D2 are
  complementary layers, not substitutes. *(resolves tension 3.)*
- **A new bespoke "state-integrity HALT" subsystem (tension 4).** Rejected as
  over-engineering for this fix: the existing fail-closed gates already halt on absent
  state; D3 adds observability (a loud log), not a parallel halt machine. Snapshot/restore
  of `.pipeline` was likewise rejected — heavy machinery with new failure modes, redundant
  with the commit-trailer evidence recovery that already exists.

## Consequences

- **Positive:** the conductor cannot be crashed by a missing `.pipeline` bookkeeping file
  regardless of cause; a dir-wipe now auto-recovers `conduct-state.json` from memory;
  the real unscoped-delete class is closed; a mid-run wipe leaves a loud forensic trail
  instead of a silent empty-state run. Deterministic and bounded — no LLM judgement, no
  blanket try/catch.
- **Negative / cost:** D3 adds one observability branch at the write choke points. The
  ensure-dir adds a cheap `mkdir` before a few writes. Acceptable.
- **Load-bearing assumption flagged for the operator:** the exact deleter (D2's concrete
  target) is ~60% inferred to be the `mutation-gate-probe` temp cleanup. This does not gate
  the ADR (D1/D3 hold regardless), but BUILD MUST confirm it via the outcome-#1 regression
  test before claiming the class closed; if the deleter proves to be a different actor, D2
  applies to that actor instead. Recorded as a known-unknown, not a blocker.

## References

- Issue: jstoup111/ai-conductor#549
- Architecture diagram: `.docs/architecture/mid-loop-pipeline-wipe-549.md`
- Verified code sites: `engine/step-runners.ts:353,423,498,517-529,547`;
  `engine/conductor.ts:3211-3226`; `engine/artifacts.ts` (sweepStaleReviewArtifacts);
  `engine/task-seed.ts` (clearStaleMarker); `daemon-cli.ts:621-627`;
  `engine/self-host/sandbox-build-env.ts:150-155`
- Related: deterministic-attribution evidence redundancy (commit-trailer derivation) —
  the durable recovery layer this ADR complements rather than replaces
