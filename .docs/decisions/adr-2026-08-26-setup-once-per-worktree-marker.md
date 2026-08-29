# ADR: Project setup runs once per worktree, gated by a content-addressed success marker

**Date:** 2026-08-26
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for #1930

## Context

`prepareWorktree` runs the project's `bin/setup` unconditionally on every daemon dispatch
(`daemon-runner.ts` invokes the `prepareWorktree` dep once per dispatch; resume, re-kick, and
halt-clear all go through the same `runFeature`). Setup is worktree *provisioning* — per-worktree
databases, dependency install, builds — so every re-dispatch of an already-prepared worktree
re-pays minutes of setup before any step runs, across every consumer project. Teardown runs only
on ship-time teardown, never on a kept worktree, so a long-lived worktree sees setup N times and
teardown zero times. #1929 (preempt/resume scheduling) multiplies this cost.

Constraints from approved decisions (governing ADRs cited, not restated):

- Reuse of prior-dispatch work must key on **code-state validity, never timestamps**
  (adr-2026-07-22-gate-evidence-code-validity-on-redispatch); content-fingerprint reuse keys hash
  the inputs and keep the commit SHA as provenance, out of the identity
  (adr-2026-07-25-content-addressed-full-suite-proof D4–D7).
- A persisted "done" may be honored only after a read-only mechanical re-check of the current
  tree, failing closed toward doing the work
  (adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch).
- Worktree-local engine state lives under `«worktree»/.daemon/` — on `LIVE_CHECKOUT_VOLATILE`,
  survives `.pipeline/` relocation plans, reaped by `git worktree remove --force`
  (adr-2026-08-09-worktree-local-provider-scratch).
- Occurrences ride the event spine as `ConductorEvent` variants with exhaustive sink
  declarations (event-spine skill; adr-2026-07-26-event-sink-registry-exhaustiveness); logged
  reasons are evidence-derived, never asserted
  (adr-2026-08-05-worktree-classification-evidence-derived-reasons).
- The project-script contract (containment, timeout, both sides in `worktree-prepare.ts`) is
  owned by adr-2026-08-07-project-teardown-hook-contract-and-containment, whose "no persisted
  state" clause this ADR amends (amendment note recorded there).
- Setup-failure triage verifies fixes by re-running `prepareWorktree`
  (adr-2026-07-09-setup-failure-triage; amendment note recorded there).

## Options Considered

### Option A: Content-addressed success marker + optional per-dispatch script
- **Pros:** Mechanical, survives daemon restarts, correct after setup failure (no marker ⇒
  re-run), re-provisioning failsafe is structural (marker dies with the worktree), invalidation
  reasons are derivable evidence; per-dispatch behavior gets its own documented vehicle.
- **Cons:** New persisted state (amends the teardown-contract ADR's no-state clause); triage
  needs an explicit force path so its verify re-runs are never vacuous.

### Option B: Gate on the worktree reconcile flag (`reused` ⇒ skip)
- **Pros:** Tiny diff, no persisted state.
- **Cons:** Unsound: a setup *failure* keeps the worktree, so the re-dispatch is `reused` and a
  never-succeeded setup is skipped forever; blind to rebase-delivered migrations/lockfile
  changes and to `bin/setup` edits.

### Option C: Idempotence-by-convention (document that `bin/setup` must be fast when prepared)
- **Pros:** No engine change.
- **Cons:** Pushes the cost onto every consumer; prompt/convention where machinery can enforce
  (repo design principle); delivers none of the issue's outcomes mechanically.

## Decision

Option A, with these binding sub-decisions:

1. **Marker.** After a *successful* `runProjectSetup`, the engine writes
   `«worktree»/.daemon/setup-ok.json` (atomic temp-file + rename;
   adr-2026-08-05-build-settle-outcome-stamp D7 shape): `{ version, setupScriptHash,
   baseSha, preparedAtCommit }`. `setupScriptHash` is a content hash of `bin/setup`'s bytes +
   mode (identity). `baseSha` is the resolved base the worktree was prepared against
   (identity — see 2). `preparedAtCommit` is provenance only, never part of the reuse
   decision, and never a timing source. A failed setup never writes the marker. The marker is
   engine-authored only.
2. **Gate predicate (read-only re-check at every dispatch).** Setup is skipped iff the marker
   exists, parses at the current version, its `setupScriptHash` equals the freshly recomputed
   hash of the current `bin/setup`, and its `baseSha` equals the currently resolved base SHA.

   > **Amended 2026-08-27 by #568:** with pinned-base work orders
   > (`adr-2026-08-27-daemon-dispatcher-executor-seam` D4), "the currently resolved base SHA"
   > for a dispatched feature is **its work order's pinned base SHA**, not the root's advancing
   > tip — so a dispatcher-side fetch/fast-forward while the pool is busy does not re-trigger
   > setup for in-flight worktrees. Every other re-run trigger stays fail-closed as written.
   Anything else — absent/corrupt/version-mismatched marker, script drift, base moved
   (rebase/re-kick), unreadable inputs — re-runs setup, fail-closed. Task commits made by the
   build advance HEAD but not the resolved base, so they do not re-trigger setup; an engine
   rebase moves the base and does, which is exactly when migrations/library changes arrive.
   A worktree recreated from its branch has no marker, so re-provisioning re-runs setup
   structurally.
3. **Reasons ride the spine.** A new `ConductorEvent` variant `project_setup` with
   `{ ran: boolean, reason }` where `reason` is a closed union:
   `no-marker | script-changed | base-moved | marker-invalid | forced` (ran: true) or
   `marker-valid | no-script` (ran: false). Declared exhaustively in `EVENT_SINKS`
   (render + persist).
   The emitter is threaded into `prepareWorktree` (widening the dep signature); emission
   happens after `beginFeatureRun` starts the per-worktree persister, so the fact lands in the
   feature's own `events.jsonl`. The daemon log line comes from the rendered event, not a
   parallel raw log write.
   > **Amended 2026-08-28 by operator decision:** the original union had six members and no
   > way to describe a consumer repository that has no `bin/setup` at all. That is a real,
   > reachable state — setup did not run, and none of the five `ran: true` reasons applies,
   > while the sole `ran: false` reason `marker-valid` would assert a valid marker that was
   > never consulted. `no-script` is therefore admitted as a seventh member, `ran: false`.
   > This widens the union only; it does not relax the rest of this decision. The prohibition
   > on a parallel raw log write stands, and the absent-script skip is reported by emitting
   > `project_setup` with `reason: 'no-script'` and rendering that event — never by a direct
   > `log()` call alongside it.
4. **Triage force path.** `prepareWorktree` gains `opts.force: boolean`; the setup-triage
   `runPrepare` injections pass `force: true` (and a forced run that succeeds rewrites the
   marker). This keeps triage's verification re-runs (`retryPrepareAfterQuarantine`,
   `fixSession`) real rather than marker-short-circuited. Triage still fires only on a
   `SetupFailureError` from an *actual* setup run — a skipped setup cannot throw, so the
   triage trigger contract is preserved.
5. **Per-dispatch lifecycle script.** A third member of the project-script contract:
   optional `bin/dispatch-start`, run by `prepareWorktree` on **every** dispatch, after the
   setup gate, under the same contract as `bin/teardown` — same env (`CI=true`,
   `WORKTREE_NAMESPACE`), mandatory `execa` timeout (own config key
   `dispatch_start_timeout_seconds`, default 120s, same fallback rules), failure contained to
   a log line, never thrown, absent script silent. This is the documented vehicle for
   genuinely per-dispatch behavior; `bin/setup` is no longer that vehicle.
6. **Untracked-state safety.** `prepareWorktree`'s `info/exclude` write adds `.daemon/`
   alongside `.claude/`, so the marker can never surface as an untracked file to
   porcelain-based consumers (uncommitted-work floor, setup-triage tree classifier) in any
   consumer repo regardless of its `.gitignore`.
7. **Scope.** Daemon dispatch and setup-triage paths only. `autoresolve.ts`'s transient
   `resolve-«slug»` worktrees are cold starts by construction (removed in `finally`) and are
   unaffected; manual `/conduct` runs are unchanged.

## Consequences

- Re-dispatch of a prepared worktree starts the conductor in seconds instead of minutes;
  preempt/resume scheduling (#1929) becomes affordable.
- Two governing ADRs carry amendment notes (setup-failure-triage sub-decision 1;
  teardown-contract no-persisted-state clause). The project-script contract now has three
  members; docs (`docs/guides/running-the-daemon.md`, settings/config reference) must document
  `bin/dispatch-start` and the new config key.
- A project whose setup depends on inputs outside `bin/setup` + the base tree (e.g. a network
  resource that decays) will not re-run setup automatically; the operator lever is deleting
  the marker (or recreating the worktree), and the event trail names every skip.
