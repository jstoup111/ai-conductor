# Implementation Plan: Project teardown hook before worktree removal

**Date:** 2026-08-07
**Design:** .docs/specs/bin-teardown-run-a-project-supplied-teardown-hook-.md
**Stories:** .docs/stories/bin-teardown-run-a-project-supplied-teardown-hook-.md
**Conflict check:** Clean as of 2026-08-07

## Summary

Adds a project-supplied `bin/teardown` hook that runs immediately before worktree removal on the
three in-scope removal paths, releasing whatever `bin/setup` provisioned. 18 tasks: one new runner
in `worktree-prepare.ts`, one new config resolver, three call-site wirings, and a structural
coverage guard with an exemption registry.

## Technical Approach

**One runner, co-located with its sibling.** `runProjectTeardown` and the `TEARDOWN_SCRIPT`
constant are added to `src/conductor/src/engine/worktree-prepare.ts` beside `runProjectSetup`
(l.499), reusing `sanitizeNamespace`, `NAMESPACE_VAR`, and `extractTail` rather than importing or
duplicating them. Per `adr-2026-08-07-project-teardown-hook-contract-and-containment`, the module's
docblock is updated to state it owns both sides of the project-script boundary.

**Containment is structural, not defensive.** `runProjectTeardown` returns a value carrying no
error and never throws. Every failure mode — non-zero exit, timeout, spawn error, non-executable
file — is caught inside it and converted to a log entry. This is what lets each of the three call
sites invoke it as a plain statement with no `try`/`catch`, and it is why removal is reached on
every branch. Tasks 5 and 6 land the containment **before** any call site is wired (Task 9), so no
intermediate commit can propagate a project-script failure into daemon control flow.

**Two deliberate divergences from `runProjectSetup`, both easy to lose by copying.** First, the
absent-script path emits **no** log line at all (the setup side logs one), because FR-4 promises
non-adopting projects a byte-identical log. Second, the child process carries a `timeout`, which
the setup side does not. Tasks 1 and 8 own these respectively.

**The `keep` ordering is the highest-risk edit in the plan.** `teardownWorktree`
(`daemon-deps.ts:126`) returns early when `keep === true`, and both `daemon-runner` call sites
(l.357, l.504) pass `true` to retain a worktree for a human. The teardown call must sit *after*
that guard; placing it before would release the resources of a build someone is about to resume.
Task 9 places it and Task 10 proves the placement by test rather than by inspection.

**Reconciliation gets exactly one invitation.** `park-reconciliation.ts` (l.637-652) attempts
`git worktree remove --force` and falls back to `rm -rf` for a path git never registered. A single
call placed before the removal attempt, inside the existing `worktreeOnDisk` guard, covers both
branches while the directory is intact — no duplicated call sites, no ordering subtlety.

**The guard follows an existing precedent exactly.** The structural test uses the TypeScript
compiler API as `test/structural/test-execution-policy.test.ts` does, walking call expressions so
comments and log strings are structurally invisible, and treating an argument form it cannot
resolve statically as a match (fail-closed).

**Test isolation.** Every scenario drives a real, controllable fixture script written into a
temporary repository — no `vi.mock` of the child process. Precedent:
`src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts`.

**Repository validation.** Per this repository's rules, `test/test_harness_integrity.sh` must pass
before every commit in this plan. It is a standing precondition on each task's commit step, not a
task of its own.

**FR-12 (maintainer documentation) is not planned as tasks.** This repository wires
`maintain-documentation` as a **gating** step (`.ai-conductor/config.yml:114`, `after: rebase`,
completion artifact `.pipeline/maintain-documentation-pass`), so the same-PR documentation
obligation — `docs/reference/environment.md`, `docs/reference/configuration.md` (including the
deliberate zero-value divergence from `auth_park_timeout_minutes`),
`docs/guides/running-the-daemon.md`, `docs/runbooks/worktree-and-evidence-recovery.md`, and
`docs/contributing/testing.md` — is delivered by that step. Architecture-review Conditions 5 and 6
are satisfied by the wired step and the standing validation rule respectively.

## Prerequisites

- No migrations, no new dependencies. `execa` already supports `timeout`; `typescript` is already a
  direct dependency of the structural suite.

## Tasks

### Task 1: Runner skeleton with a completely silent absent-script path
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: given a worktree with no `bin/teardown`, `runProjectTeardown` resolves and the injected log sink receives **zero** calls (assert call count is 0, in both default and verbose modes).
2. Verify test fails (RED)
3. Implement: export `TEARDOWN_SCRIPT = join('bin', 'teardown')` and `runProjectTeardown(worktreePath, log?, opts?)`; `access(script)` failure returns immediately with **no** log call — deliberately unlike `runProjectSetup`'s skip notice.
4. Verify test passes (GREEN)
5. Commit with message: "feat(worktree): add runProjectTeardown with a silent absent-script path"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — new `TEARDOWN_SCRIPT` const and `runProjectTeardown`
- src/conductor/test/engine/worktree-prepare.test.ts — absent-script silence test

**Wired-into:** src/conductor/src/engine/daemon-deps.ts#teardownWorktree, src/conductor/src/engine/daemon-park-cli.ts#dispatchDaemonPark, src/conductor/src/engine/park-reconciliation.ts#reconcileMergedPark
> **Amended 2026-08-08 by #1306:** this declaration was authored as
> `none (inert until src/conductor/src/engine/daemon-deps.ts)`. That waiver is unsatisfiable for this
> plan: `checkInertContractContradiction` (`wiring-probe.ts:732`) searches the whole tree at gate
> time, not the declaring task's own diff, so an `inert until <ref>` waiver whose `<ref>` is wired by
> a *later task in the same plan* is always contradicted once that task lands — the gate then reports
> "contract is stale, switch to a declared call site". The three call sites above are the real
> enclosing symbols of `runProjectTeardown`'s production callers (`daemon-deps.ts:128`,
> `daemon-park-cli.ts:237`, `park-reconciliation.ts:655`), verified at
> `6a97b6e16`. Amended per adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts §5 (a
> mid-BUILD discovery returns to DECIDE); the correction is recorded rather than silently replaced.

**Dependencies:** none

---

### Task 2: Execution environment matches the setup contract
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a real fixture `bin/teardown` writes `CI`, `WORKTREE_NAMESPACE`, and `process.cwd()` to a file outside the worktree; assert `CI === 'true'`, the namespace is non-empty, and cwd equals the worktree path.
2. Verify test fails (RED)
3. Implement: `execa(script, [], { cwd: worktreePath, all: true, env: { CI: 'true', [NAMESPACE_VAR]: namespace } })`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(worktree): run bin/teardown with the setup environment contract"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — execa invocation
- src/conductor/test/engine/worktree-prepare.test.ts — environment assertions

**Wired-into:** same as Task 1
**Dependencies:** Task 1

---

### Task 3: Namespace derived from the path, with no persisted state
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: delete `.pipeline/` and `.env` from the worktree, run teardown, assert the observed namespace equals `sanitizeNamespace(basename(worktreePath))`; add a case whose basename requires sanitization and assert the sanitized form is passed.
2. Verify test fails (RED)
3. Implement: compute `namespace` inside `runProjectTeardown` via the same `sanitizeNamespace(basename(worktreePath))` call; read nothing from disk.
4. Verify test passes (GREEN)
5. Commit with message: "feat(worktree): derive the teardown namespace from the worktree path"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — namespace derivation
- src/conductor/test/engine/worktree-prepare.test.ts — missing-state and sanitization cases

**Wired-into:** same as Task 1
**Dependencies:** Task 2

---

### Task 4: Successful output is summarized, echoed only when verbose
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing test: a fixture printing many lines yields one summary line in default mode and full line-by-line echo in verbose mode; a fixture printing nothing, and one printing only blank lines, each yield **no** summary line.
2. Verify test fails (RED)
3. Implement: mirror `runProjectSetup`'s success-output handling — filter blank lines, echo per-line when verbose, otherwise emit a single suppressed-count line, and skip the line entirely when no non-blank output exists.
4. Verify test passes (GREEN)
5. Commit with message: "feat(worktree): summarize successful teardown output"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — success-path logging
- src/conductor/test/engine/worktree-prepare.test.ts — verbosity and empty-output cases

**Wired-into:** same as Task 1
**Dependencies:** Task 2

---

### Task 5: A non-zero exit is contained and reported with an output tail
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing test: a fixture exiting non-zero after distinctive output causes `runProjectTeardown` to resolve (never reject), emitting exactly one failure entry containing the worktree path and a bounded tail; a second fixture exits non-zero with **no** output and still produces an identifying entry.
2. Verify test fails (RED)
3. Implement: `catch` around the invocation; build the tail with the existing `extractTail` helper at the same limit the setup side uses; emit one entry with a stable greppable prefix; return normally.
4. Verify test passes (GREEN)
5. Commit with message: "feat(worktree): contain and report a failing bin/teardown"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — failure containment and reporting
- src/conductor/test/engine/worktree-prepare.test.ts — non-zero and no-output cases

**Wired-into:** same as Task 1
**Dependencies:** Task 4

---

### Task 6: Spawn failures are contained identically
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing test: a `bin/teardown` that is present but non-executable, one whose shebang names a missing interpreter, and a `bin/teardown` that is a **directory** each resolve without rejecting and emit exactly one failure entry distinguishable from the absent-script silence.
2. Verify test fails (RED)
3. Implement: ensure the `access`/spawn distinction routes a present-but-unusable script into the failure branch rather than the absent branch.
4. Verify test passes (GREEN)
5. Commit with message: "feat(worktree): treat an unusable bin/teardown as a contained failure"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — spawn-error branch
- src/conductor/test/engine/worktree-prepare.test.ts — unusable-script cases

**Wired-into:** same as Task 1
**Dependencies:** Task 5

---

### Task 7: Resolve the teardown time bound from configuration
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing test: table-driven over absent, valid positive, `0`, negative, non-numeric, and non-finite inputs; assert the default of 120 seconds for every invalid case with exactly one warning, the provided value for the valid case, and that **no** input yields an unbounded result.
2. Verify test fails (RED)
3. Implement: add a `teardown_timeout_seconds` resolver in `resolved-config.ts` beside `auth_park_timeout_minutes`; unlike that key, treat `0` and negatives as invalid rather than as opt-out signals.
4. Verify test passes (GREEN)
5. Commit with message: "feat(config): resolve teardown_timeout_seconds with a non-disableable bound"

**Files likely touched:**
- src/conductor/src/engine/resolved-config.ts — new resolver
- src/conductor/test/engine/resolved-config.test.ts — table-driven validation cases

**Wired-into:** src/conductor/src/engine/worktree-prepare.ts#runProjectTeardown
**Dependencies:** none

---

### Task 8: Apply the bound and report a timeout
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing test: a genuinely non-terminating fixture with a short configured bound causes teardown to be abandoned at the bound, emitting one timeout entry naming the worktree, with `runProjectTeardown` resolving normally.
2. Verify test fails (RED)
3. Implement: thread the resolved bound into the `execa` call's `timeout` option; classify a timeout distinctly from a non-zero exit in the emitted entry.
4. Verify test passes (GREEN)
5. Commit with message: "feat(worktree): bound bin/teardown and report timeouts"

**Files likely touched:**
- src/conductor/src/engine/worktree-prepare.ts — timeout option and classification
- src/conductor/test/engine/worktree-prepare.test.ts — hanging-script case

**Wired-into:** same as Task 1
**Dependencies:** Task 7

---

### Task 9: Invite teardown on the daemon reap path
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: `teardownWorktree(worktree, false)` runs the fixture teardown exactly once, and a fixture asserting a worktree file is readable succeeds — proving teardown precedes removal; assert the worktree no longer exists afterward.
2. Verify test fails (RED)
3. Implement: call `runProjectTeardown` in `daemon-deps.ts`'s `teardownWorktree` **after** the `if (keep) return;` guard and before the `git worktree remove` call; thread the resolved timeout through the existing config handle.
4. Verify test passes (GREEN)
5. Commit with message: "feat(daemon): run bin/teardown before reaping a worktree"

**Files likely touched:**
- src/conductor/src/engine/daemon-deps.ts — teardown invitation in `teardownWorktree`
- src/conductor/test/engine/daemon-deps.test.ts — ordering and removal assertions

**Wired-into:** src/conductor/src/engine/daemon-deps.ts#teardownWorktree
**Dependencies:** Task 8

---

### Task 10: A retained worktree never runs teardown
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: `teardownWorktree(worktree, true)` produces **zero** teardown invocations and leaves the worktree in place, while the same fixture with `keep === false` produces exactly one; add coverage at both `daemon-runner` retention call sites asserting no spawn.
2. Verify test fails (RED)
3. Implement: confirm and lock the call's position after the `keep` guard; adjust if the RED run shows the guard is bypassed.
4. Verify test passes (GREEN)
5. Commit with message: "test(daemon): prove a retained worktree is never torn down"

**Files likely touched:**
- src/conductor/src/engine/daemon-deps.ts — guard ordering
- src/conductor/test/engine/daemon-deps.test.ts — keep-true zero-invocation assertions
- src/conductor/test/engine/daemon-runner.test.ts — retention-path no-spawn assertions

**Wired-into:** same as Task 9
**Dependencies:** Task 9

---

### Task 11: Invite teardown on the operator reclaim path
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: running the reclaim-worktree command for a slug with a fixture teardown invokes it once before removal, and the command's normal removal output is unchanged.
2. Verify test fails (RED)
3. Implement: call `runProjectTeardown` in `daemon-park-cli.ts`'s reclaim branch immediately before `removeWorktree`, routing log output through the command's existing `out` sink.
4. Verify test passes (GREEN)
5. Commit with message: "feat(park-cli): run bin/teardown before reclaiming a worktree"

**Files likely touched:**
- src/conductor/src/engine/daemon-park-cli.ts — teardown invitation in the reclaim branch
- src/conductor/test/engine/daemon-park-cli.test.ts — reclaim ordering assertions

**Wired-into:** src/conductor/src/engine/daemon-park-cli.ts#reclaim-worktree
**Dependencies:** Task 8

---

### Task 12: Refused and empty reclaims never spawn teardown
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: an in-progress slug (reclaim refused) and a slug with no retained worktree each produce zero teardown invocations; a failing teardown leaves the command's exit status identical to the passing case.
2. Verify test fails (RED)
3. Implement: position the invitation after the in-progress and existence checks so both refusal branches return before it.
4. Verify test passes (GREEN)
5. Commit with message: "test(park-cli): prove refused reclaims release nothing"

**Files likely touched:**
- src/conductor/src/engine/daemon-park-cli.ts — invitation placement
- src/conductor/test/engine/daemon-park-cli.test.ts — refusal-branch assertions

**Wired-into:** same as Task 11
**Dependencies:** Task 11

---

### Task 13: Invite teardown once on the reconciliation path
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: reconciling a slug whose registered worktree carries a fixture teardown invokes it once before removal, and the existing `worktree-removed` step is still reported.
2. Verify test fails (RED)
3. Implement: call `runProjectTeardown` once in `park-reconciliation.ts` inside the `worktreeOnDisk` guard, before the `git worktree remove` attempt — a single call covering both removal branches.
4. Verify test passes (GREEN)
5. Commit with message: "feat(park-reconciliation): run bin/teardown before worktree cleanup"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts — single teardown invitation
- src/conductor/test/engine/park-reconciliation.test.ts — ordering and step assertions

**Wired-into:** src/conductor/src/engine/park-reconciliation.ts#reconcileMergedPark
> **Amended 2026-08-08 by #1306:** this declaration was authored as
> `src/conductor/src/engine/park-reconciliation.ts#reconcile`. No symbol named `reconcile` is
> exported from that file, on this branch or on `origin/main` — its exports are `proveByMergedPrHead`,
> `reconcileParkedFeatures`, and `reconcileMergedPark`. The anchor named a symbol that never existed;
> `reconcileMergedPark` is the function enclosing the `runProjectTeardown` call site
> (`park-reconciliation.ts:655`). Amended per
> adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts §5.

**Dependencies:** Task 8

---

### Task 14: The fallback branch is covered and refusals are preserved
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: a path git never registered drives the `rm -rf` fallback and teardown has already run; a worktree path that does not exist skips teardown entirely; a failing teardown plus a failing removal on a git-owned path still returns the existing `worktree-remove-failed` refusal verbatim.
2. Verify test fails (RED)
3. Implement: confirm the single call's placement satisfies all three; adjust guard ordering if RED shows otherwise.
4. Verify test passes (GREEN)
5. Commit with message: "test(park-reconciliation): cover the fallback branch and refusal preservation"

**Files likely touched:**
- src/conductor/src/engine/park-reconciliation.ts — guard ordering
- src/conductor/test/engine/park-reconciliation.test.ts — fallback and refusal cases

**Wired-into:** same as Task 13
**Dependencies:** Task 13

---

### Task 15: Structural guard detects worktree-removal call sites
**Story:** 10
**Type:** infrastructure

**Steps:**
1. Write failing test: over the real `src/conductor/src/` tree, the guard's detector returns exactly the modules known to contain removal calls, and returns nothing for a fixture module whose only mention is in a comment or a log string.
2. Verify test fails (RED)
3. Implement: a new structural suite using `import ts from 'typescript'`, walking call expressions for process-invoking callees whose arguments name `worktree` then `remove`, in both literal-command and array forms; treat an unresolvable argument form as a match.
4. Verify test passes (GREEN)
5. Commit with message: "test(structural): detect worktree-removal call sites via the TS AST"

**Files likely touched:**
- src/conductor/test/structural/worktree-removal-coverage.test.ts — detector and its cases

**Wired-into:** none (no new production surface)
**Dependencies:** none

---

### Task 16: Guard fails an unclassified or de-wired removal path
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing test: a fixture module with a removal call in neither the routed set nor the registry fails with a message naming the module, both classification options, and the coverage-guard ADR; a routed module with its teardown call removed also fails; the guard's own file is not classified.
2. Verify test fails (RED)
3. Implement: add the routed-set assertion (a routed module must actually call the runner), the unclassified failure with its message, and the self-exclusion.
4. Verify test passes (GREEN)
5. Commit with message: "test(structural): fail unclassified and de-wired removal paths"

**Files likely touched:**
- src/conductor/test/structural/worktree-removal-coverage.test.ts — classification assertions

**Wired-into:** same as Task 15
**Dependencies:** Task 15

---

### Task 17: Ship the exemption registry
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing test: the registry contains exactly four entries — `autoresolve.ts`, `engineer/worktree-authoring.ts`, `worktree.ts`, `worktree-shared.ts` — each with a non-empty reason, and the whole guard passes against the real tree.
2. Verify test fails (RED)
3. Implement: declare the registry as a literal array of `{ module, reason }` in the guard's source; `autoresolve.ts`'s reason states it prepares its worktree and therefore leaks and that the exclusion is a deferred decision; the other three state why they provision nothing or are pass-through.
4. Verify test passes (GREEN)
5. Commit with message: "test(structural): add the worktree-removal exemption registry"

**Files likely touched:**
- src/conductor/test/structural/worktree-removal-coverage.test.ts — registry and presence assertions

**Wired-into:** same as Task 15
**Dependencies:** Task 16

---

### Task 18: Registry entries cannot rot or flatten
**Story:** 11
**Type:** negative-path

**Steps:**
1. Write failing test: an entry with an empty or whitespace-only reason fails the guard; an entry naming a module that no longer contains a removal call fails as stale; the `autoresolve.ts` reason is asserted distinct from the provisions-nothing reasons.
2. Verify test fails (RED)
3. Implement: add reason-emptiness validation, staleness validation against the detector's output, and the distinctness assertion.
4. Verify test passes (GREEN)
5. Commit with message: "test(structural): reject empty, stale, and flattened exemption reasons"

**Files likely touched:**
- src/conductor/test/structural/worktree-removal-coverage.test.ts — registry validation cases

**Wired-into:** same as Task 15
**Dependencies:** Task 17

---

## Task Dependency Graph

```
Task 1 (runner skeleton, silent absent path)
  └─ Task 2 (environment contract)
       ├─ Task 3 (namespace derivation)
       └─ Task 4 (success output)
            └─ Task 5 (non-zero containment)
                 └─ Task 6 (spawn-error containment)

Task 7 (config resolver)  ──┐
Task 6 ─────────────────────┴─ Task 8 (apply bound + timeout report)
                                 ├─ Task 9 (reap wiring) ── Task 10 (keep-true negative)
                                 ├─ Task 11 (reclaim wiring) ── Task 12 (refusal negatives)
                                 └─ Task 13 (reconciliation wiring) ── Task 14 (fallback + refusal)

Task 15 (guard detector) ── Task 16 (classification failures) ── Task 17 (registry) ── Task 18 (registry validation)
```

Tasks 1–8 and 15–18 are two independent chains; 15–18 may run in parallel with the runner chain.
Tasks 9, 11, and 13 are independent of one another and all gate on Task 8.

## Integration Points

- **After Task 8** — the runner is complete and fully contained; it can be exercised end-to-end in
  isolation with no call site wired.
- **After Task 10** — the daemon reap path is complete, including the retention guarantee. This is
  the first point at which a real project would observe resources being released.
- **After Task 14** — all three in-scope removal paths are wired and their negatives proven.
- **After Task 18** — coverage enforcement is live; a new removal path now fails the suite until
  classified.

## Coverage Mapping

| Story | Tasks | Requirement |
| --- | --- | --- |
| 1 | 2, 9 | FR-1, FR-2, FR-5 |
| 2 | 3 | FR-3 |
| 3 | 1 | FR-4 |
| 4 | 10 | FR-5 |
| 5 | 11, 12 | FR-5 |
| 6 | 13, 14 | FR-5 |
| 7 | 5, 6 | FR-6, FR-8 |
| 8 | 7, 8 | FR-7 |
| 9 | 4 | FR-9 |
| 10 | 15, 16 | FR-10 |
| 11 | 17, 18 | FR-11 |
| — | `maintain-documentation` gating step | FR-12 |

Every story's happy and negative acceptance criteria map to at least one task above. FR-12 is the
sole requirement with no plan task, delivered by the wired gating step per the Technical Approach.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] `test/test_harness_integrity.sh` passes before each commit
