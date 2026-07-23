**Status:** Accepted

# Stories: Repair missing session hooks instead of terminally halting the build

Technical track (no PRD). Acceptance criteria derive from the technical intent of
`jstoup111/ai-conductor#896` and the APPROVED ADR
`adr-2026-07-23-session-hook-repair-before-halt.md`. M tier ⇒ negative paths on every story,
concentrated on the ordering invariant (R1).

**Terms.**
- *enforcement scripts* = `.pipeline/session-hooks/{pre-dispatch,post-dispatch,mutation-gate}.sh`
  — the three names in the existing `expectedHooks` list at `conductor.ts:733`.
- *repair set* = the enforcement scripts **plus** `docs-guard.sh`, i.e. everything
  `writeSessionHooks` provisions.
- *the guard* = `checkAttributionMachineryIntact` (`conductor.ts:688`), reached via
  `seedAndCheckAttributionMachinery` (`conductor.ts:668`).
- *diagnostic* = the non-null string the guard returns, which `conductor.ts:3225-3227` converts
  into a failed step.

---

## Story TI-1: An idempotent, outcome-reporting session-hook repair primitive

**Requirement:** ADR decision 1

As the conductor engine, I want a single exported function that (re)provisions the session-hook
scripts and their settings wiring and tells me what it managed to write, so that both worktree
provisioning and the build preflight can restore this machinery from one implementation.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose `.pipeline/session-hooks/` directory is absent entirely, when
  `ensureSessionHooks(worktreeRoot)` is called, then all four repair-set scripts exist, are mode
  0755, and their contents are byte-identical to `PRE_DISPATCH_HOOK`, `POST_DISPATCH_HOOK`,
  `MUTATION_GATE_HOOK`, and `DOCS_GUARD_HOOK` from `session-hook-assets.ts`.
- Given a worktree where only `mutation-gate.sh` is missing, when `ensureSessionHooks` is called,
  then it is restored and the returned outcome names it under `repaired` with an empty `failed`.
- Given a worktree where all four scripts already exist and are current, when `ensureSessionHooks`
  is called a second time, then the call succeeds, `failed` is empty, and no script's content
  changes (idempotent).
- Given a worktree whose `.claude/settings.local.json` has lost its session-hook entries but
  retains unrelated operator keys, when `ensureSessionHooks` is called, then both `mutation-gate.sh`
  matcher entries (`Edit|Write|NotebookEdit` → `… write`, `Bash` → `… bash`), the `Task|Agent`
  pre/post entries, and the `docs-guard.sh` entry are present exactly once each, and every
  unrelated key and non-engine hook entry is preserved byte-for-byte.

#### Negative Paths
- Given `.pipeline/session-hooks/` cannot be written (directory made read-only), when
  `ensureSessionHooks` is called, then it does NOT throw, and the returned outcome lists every
  unwritten script under `failed` with its error.
- Given the settings file exists but contains malformed JSON, when `ensureSessionHooks` is called,
  then the existing corrupt-file backup behavior is preserved (`.bak-<ts>`) and the scripts are
  still provisioned — a settings failure never suppresses script repair.
- Given a partial failure (scripts writable, settings not), when `ensureSessionHooks` returns, then
  `repaired` reflects the scripts actually written and the settings failure is reported without
  being conflated with a script failure.

### Done When
- [ ] `ensureSessionHooks(worktreeRoot, log?)` is exported from `worktree-prepare.ts` and returns
      `{ repaired: string[]; failed: Array<{ file: string; error: string }> }`.
- [ ] `prepareWorktree` routes through it and its observable behavior is unchanged.
- [ ] Idempotence, partial-restore, settings merge-preserve, and unwritable-dir cases are each
      covered by a test.

---

## Story TI-2: The build preflight repairs missing hooks and proceeds

**Requirement:** ADR decision 2, 3; #896 desired outcomes 1 and 3

As a build running under the daemon, I want a worktree that has lost its session-hook scripts to be
re-provisioned in place at the preflight, so that a regenerable-asset loss never terminally halts
work that is otherwise progressing.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/` exists, `task-status.json` is seeded, the stamp path is writable, and all
  three enforcement scripts are ABSENT, when the guard runs, then the scripts are restored and the
  guard returns `null` — no diagnostic, no failed step, no HALT marker.
- Given the same worktree, when the guard runs, then at least one `console.warn` line prefixed
  `[session-hooks]` names each restored script, so the repair is visible in `daemon.log`.
- Given only `post-dispatch.sh` is missing, when the guard runs, then it is restored, the other two
  are not rewritten needlessly, and the guard returns `null`.
- Given all four repair-set scripts are present and current, when the guard runs, then no repair is
  attempted, no `[session-hooks]` warning is emitted, and the guard returns `null` — the healthy
  path is unchanged and silent.
- Given the scenario that halted `acceptance-specs-halts-when-the-red-evidence-marke`
  (12 of 13 tasks resolved, hooks wiped mid-loop), when the build step is re-dispatched, then it
  proceeds to dispatch rather than failing the step.

#### Negative Paths
- Given the enforcement scripts are missing AND `.pipeline/session-hooks/` cannot be written, when
  the guard runs, then it returns a diagnostic that names the **repair failure** and the specific
  unwritten files — distinct in wording from today's "session-hooks/ is missing expected script(s)"
  absence message, so an operator can tell "could not restore" from "was not there".
- Given `docs-guard.sh` is the ONLY missing script, when the guard runs, then it is repaired and
  the guard returns `null` — a missing `docs-guard.sh` alone can never produce a diagnostic
  (halt-check set is unchanged; ADR decision 5, risk R4).
- Given `.pipeline/` does not exist at all, when the guard runs, then the existing early return
  (`null`, nothing to attribute yet) is preserved and NO repair is attempted — the guard must not
  start provisioning hooks into a project that has not reached pipeline initialization.
- Given `task-status.json` is missing and unseedable (plan unresolvable), when the guard runs, then
  the existing plan-unresolvable diagnostic is returned unchanged and unaffected by this feature —
  the `demote-task-stamping-to-telemetry` HALT class is out of scope.
- Given the stamp path is not writable, when the guard runs, then the existing
  "current-task stamp path is not writable" diagnostic still fires unchanged.

### Done When
- [ ] Repair-then-recheck is wired into the session-hooks branch of the guard only.
- [ ] Every other branch of the guard returns byte-identical diagnostics to today (regression test
      per branch).
- [ ] A test asserts the healthy path performs no writes and emits no warning.

---

## Story TI-3: The mutation gate is never armed against a missing script

**Requirement:** ADR "Ordering invariant"; architecture-review risk R1

As the harness, I want the build-step-active marker to be written only when the enforcement scripts
are proven present on disk, so that repairing the preflight can never silently convert #505
Surface B from a fail-closed write gate into a no-op.

### Acceptance Criteria

#### Happy Path
- Given the enforcement scripts were missing and were successfully repaired, when the guard
  returns, then its `null` verdict was produced by re-reading the filesystem after the repair — a
  test that lets the repair report success while the files remain absent still yields a diagnostic.
- Given a repaired worktree, when the build step proceeds, then `writeBuildStepMarker` is called
  and `mutation-gate.sh` exists at the path recorded in `.claude/settings.local.json`.

#### Negative Paths
- Given the repair reports success but `mutation-gate.sh` is absent from disk at re-check time,
  when the guard runs, then it returns a diagnostic and `writeBuildStepMarker` is NOT called —
  asserted on the marker file, not only on the return value.
- Given the repair partially succeeds (`pre-dispatch.sh` restored, `mutation-gate.sh` not), when
  the guard runs, then it returns a diagnostic naming `mutation-gate.sh` and the marker is not
  written — a partial repair is never treated as a pass.
- Given the guard returns a diagnostic for any reason, when the step is short-circuited, then
  `.pipeline/build-step-active` does not exist afterwards (the `!machineryIssue` predicate at
  `conductor.ts:3204-3207` is preserved).

### Done When
- [ ] A test forces "repair claims success, file absent" and asserts both a diagnostic and an
      unwritten marker.
- [ ] A test asserts the marker exists after a genuine repair.

---

## Story TI-4: Settings wiring is restored alongside the scripts

**Requirement:** ADR decision 4

As the harness, I want a worktree whose hook wiring was lost from `.claude/settings.local.json` to
be re-armed at the preflight, so that present-but-unwired scripts do not leave enforcement silently
inert.

### Acceptance Criteria

#### Happy Path
- Given all four scripts exist on disk but `.claude/settings.local.json` has no session-hook
  entries, when the guard's repair path runs, then the wiring is re-merged and the guard returns
  `null`.
- Given wiring is already complete, when repair runs, then the settings file's parsed content is
  unchanged (no duplicate entries, no reordering-induced churn beyond the existing
  merge-preserve semantics).

#### Negative Paths
- Given the settings file cannot be written, when repair runs, then the guard does NOT return a
  diagnostic on that basis alone — missing wiring is repaired opportunistically and logged, but it
  is not added to the halt-check set (scope discipline: this feature must not create a NEW way to
  terminally halt a build).
- Given an operator has added their own unrelated `PreToolUse` entry, when repair runs, then that
  entry survives untouched.

### Done When
- [ ] Wiring repair runs as part of `ensureSessionHooks`, not as a separate guard branch.
- [ ] A test proves a wiring failure alone never produces a diagnostic.

---

## Story TI-5: Documentation and changelog reflect the new preflight behavior

**Requirement:** CLAUDE.md "Documentation Upkeep" + Release & Update Gates

As an operator, I want the daemon-operations guide to describe self-healing session hooks, so I do
not park a feature or hand-restore `.pipeline/` for a condition the engine now fixes itself.

### Acceptance Criteria

#### Happy Path
- Given the change ships, when `docs/daemon-operations.md` is read, then it states that missing
  session-hook scripts are re-provisioned automatically at the build preflight, names the
  `[session-hooks]` log prefix to grep for, and states that a *recurring* repair indicates a
  `.pipeline`-wipe defect worth investigating.
- Given the change ships, when `CHANGELOG.md` is read, then `## [Unreleased]` carries a `Fixed`
  entry referencing #896.

#### Negative Paths
- Given the release gate's path classifier flags a breaking surface for `worktree-prepare.ts`, when
  the build responds, then it commits a `.docs/release-waivers/` waiver naming the flagged
  canonical surface with a real rationale — it does NOT invent an empty migration block
  (CLAUDE.md waiver rule; architecture-review boundary check).
- Given `VERSION`, when the PR is prepared, then it is NOT bumped (frozen pre-v1).

### Done When
- [ ] `docs/daemon-operations.md` and `src/conductor/README.md` updated.
- [ ] `CHANGELOG.md` `[Unreleased] → Fixed` entry present.
- [ ] `test/test_harness_integrity.sh` passes.
