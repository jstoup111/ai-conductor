# Implementation Plan: ship→CI feedback loop + fixture-portability guards

**Date:** 2026-07-07
**Design:** .docs/decisions/adr-2026-07-07-ship-ci-feedback-loop.md (APPROVED) + .docs/architecture/ship-ci-feedback-loop.md
**Stories:** .docs/stories/ship-ci-feedback-loop.md (TR-1..TR-7)
**Conflict check:** Clean as of 2026-07-07 (.docs/conflicts/ship-ci-feedback-loop.md)
**Source-Ref:** jstoup111/ai-conductor#397

## Summary

Extends the daemon mergeable sweep to observe shipped PRs' CI check rollups and drive bounded
auto-remediation of red ships, plus a structural fixture-portability guard. 30 tasks across 8
phases; two deliverables bundled per operator scope decision.

## Technical Approach

- **Classification (pr-labels.ts):** add `checksOutcome: 'failed' | 'pending' | 'green' | 'none'`
  to `PrMergeState`, derived in `prMergeState` from the per-check `status`/`conclusion` fields the
  existing `gh pr view` call already returns. Failed wins over pending; malformed entries classify
  as pending (fail-safe); the UNKNOWN/NOTFOUND sentinels carry `none`. Existing
  `hasFailingOrPendingChecks`/`isMergeable` are untouched.
- **Sweep branch (mergeable-sweep.ts):** in the per-entry loop, `checksOutcome === 'failed'` →
  ensure+add `ci-failed` label (idempotent) and collect the entry as a CI-fix candidate;
  `green` → remove `ci-failed` + reset `ciFixAttempts`. A post-label CI-fix pass mirrors the
  Task-17 autoresolve pass: injected `CiFixDispatchOpts { enabled, isEligible, dispatch }`, one
  dispatch per tick, attempt counter + `lastCiFixAt` bumped on the survivor entry BEFORE dispatch
  (crash-safe), `dispatchResult.kind === 'green-verified'` reserved for future counter reset (the
  normal reset is green observation on a later sweep).
- **Eligibility (new ci-fix module):** gates in order — config enabled, checks failed, attempts
  < 2, `mergeable !== 'CONFLICTING'` (conflict resolution takes precedence, per conflict-check),
  no `needs-remediation` label (sticky), shared serial guard `isResolutionInFlight()` (defer, no
  counter burn), cooldown vs `lastCiFixAt`.
- **Resolver (new ci-fix module, reusing autoresolve.ts primitives):** `withResolveWorktree(slug,
  branch, repoCwd, fn)` at the PR branch tip; RETRY hint = failing check names + `gh run view
  --log-failed` excerpt (degrades to names+links); injected fix-runner seam (same pattern as
  `RebaseResolver` — production impl drives a fix session, tests inject a stub); then
  `runAcceptanceGuards` + `runSuiteGate` gate the push (`pushRefreshed`). Never merges, never
  touches the processed ledger.
- **Exhaustion:** attempts ≥ 2 and still failed → `needs-remediation` label + escalation comment
  (build-failure-escalation upsert path) + HALT-grade `ci_failed` event; `needs-remediation` is
  the existing sticky suppressor, so escalation fires exactly once.
- **Events (types/events.ts):** new `ci_failed` event type rendered ✋-grade in daemon logs
  (halt-monitor tails these). Emitted on failed-transition/dispatch/exhaustion — not every tick.
- **Config:** `ci_watch.enabled`, default **true**, malformed → default; read once at daemon-cli
  wiring alongside `mergeable_autoresolve`.
- **Structural guard (new test/structural/fixture-portability.test.ts):** glob-based scanner
  (unlike non-autonomy's import graph) with the same conventions — comment-line exemption,
  `// portability-ok: <reason>` escape hatch (empty reason still flags), embedded known-bad
  falsifiability fixtures. Three matchers: git-init-without`-b` over `test/**` (all four exec
  shapes), timer-`.unref()` over `src/engine/**`, tmp-write-outside-target-dir over
  `src/engine/**`. The 16 inventoried non-portable `git init` sites are fixed in-plan.
- **Sequencing:** classification → registry/config → sweep label lifecycle → dispatch seam →
  resolver → exhaustion → wiring/docs → guard + fixture fixes. The guard lands last so the tree
  it enforces is already clean.

## Prerequisites

None external. All work in `src/conductor/` (plus README/CHANGELOG). Tests use the injected
`GhRunner`/runner seams and the `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch convention; one
real-binary smoke for the resolver.

## Tasks

### Task 1: checksOutcome classification — happy shapes
**Story:** TR-1 happy (failed wins; pending; green; none)
**Type:** happy-path
**Steps:**
1. Write failing tests in `test/engine/pr-labels.test.ts` (or sibling): rollup with one FAILURE +
   one pending → `checksOutcome: 'failed'`; all-running → `'pending'`; all-passing → `'green'`;
   empty/absent rollup → `'none'`.
2. Verify RED.
3. Implement `classifyChecksOutcome(checks)` in `pr-labels.ts`; add `checksOutcome` to
   `PrMergeState` and populate in `prMergeState`.
4. Verify GREEN. 5. Commit "feat: checksOutcome classification on PrMergeState".
**Files likely touched:** src/conductor/src/engine/pr-labels.ts; test/engine/pr-labels tests
**Dependencies:** none

### Task 2: checksOutcome classification — adversarial shapes
**Story:** TR-1 negative (malformed entries → pending; sentinel → none; no behavior drift)
**Type:** negative-path
**Steps:**
1. Failing tests: rollup entries with missing/garbage `status`+`conclusion` → `'pending'` and no
   throw; UNKNOWN/NOTFOUND sentinels carry `checksOutcome: 'none'`; assert existing
   `isMergeable`/`hasFailingOrPendingChecks` expectations byte-identical on the same fixtures.
2. RED → implement guards in `classifyChecksOutcome` + sentinel constants → GREEN → commit.
**Files likely touched:** pr-labels.ts; its tests
**Dependencies:** 1

### Task 3: WatchEntry ciFix fields + legacy normalization
**Story:** TR-3 happy (legacy entry normalizes to 0)
**Type:** infrastructure
**Steps:**
1. Failing test: `readWatch` on a legacy line (no ciFix fields) yields `ciFixAttempts: 0` and no
   `lastCiFixAt`; round-trips through `rewriteWatch` unchanged otherwise.
2. RED → add `ciFixAttempts?`/`lastCiFixAt?` to `WatchEntry` with zero-default normalization
   (mirror `resolveAttempts`) → GREEN → commit.
**Files likely touched:** mergeable-sweep.ts; test/engine/mergeable-sweep tests
**Dependencies:** none

### Task 4: ci_watch.enabled config key
**Story:** TR-3/TR-6 (default true; malformed → default, no crash)
**Type:** infrastructure
**Steps:**
1. Failing tests on the config loader: absent key → enabled true; explicit false → false;
   malformed value (string/number) → true without throwing.
2. RED → add `ci_watch` to the config schema/parse (same shape as `mergeable_autoresolve`) →
   GREEN → commit.
**Files likely touched:** the HarnessConfig type + config parser module; its tests
**Dependencies:** none

### Task 5: ci_failed event type, ✋-grade rendering
**Story:** TR-2 happy (event emitted in the format the halt-monitor tails)
**Type:** infrastructure
**Steps:**
1. Failing test: a `ci_failed` event {prUrl, slug, checks, attempts, phase:
   'detected'|'dispatched'|'exhausted'} type-checks and its daemon-log line carries the ✋ marker.
2. RED → add to the events union in types/events.ts + log rendering → GREEN → commit.
**Files likely touched:** src/conductor/src/types/events.ts; daemon log rendering; tests
**Dependencies:** none

### Task 6: sweep adds ci-failed label on failed rollup (idempotent)
**Story:** TR-2 happy (ensure+add once; not re-added when present)
**Type:** happy-path
**Steps:**
1. Failing sweep test (injected GhRunner): failed entry without label → `ensureLabel`+`addLabel`
   called once; failed entry already labeled → no add call.
2. RED → implement the failed-branch label handling in the per-entry loop → GREEN → commit.
**Files likely touched:** mergeable-sweep.ts; sweep tests
**Dependencies:** 1, 3

### Task 7: sweep removes ci-failed + resets attempts on green
**Story:** TR-2 happy (remove-on-green + counter reset); TR-5 negative (post-human-clear recovery)
**Type:** happy-path
**Steps:**
1. Failing tests: green entry with label + `ciFixAttempts: 2` → label removed, attempts 0 in
   rewritten registry; green entry without label → no gh call.
2. RED → implement green-branch reset → GREEN → commit.
**Files likely touched:** mergeable-sweep.ts; sweep tests
**Dependencies:** 6

### Task 8: pending no-op + transition-only event emission
**Story:** TR-2 happy (pending → no label/event/dispatch) + negative (no ✋ spam on repeat sweeps)
**Type:** negative-path
**Steps:**
1. Failing tests: pending entry → zero label/event/dispatch side effects; same entry failed on two
   consecutive sweeps with label already present → `ci_failed(detected)` event emitted only on the
   first (label-absent→present transition is the emission edge).
2. RED → gate event emission on the transition → GREEN → commit.
**Files likely touched:** mergeable-sweep.ts; sweep tests
**Dependencies:** 6

### Task 9: label gh-error resilience
**Story:** TR-2 negative (label call errors → logged, entry survives, sweep continues)
**Type:** negative-path
**Steps:**
1. Failing test: GhRunner throws on the label call for entry A → A remains in survivors, entry B
   still processed, sweep resolves without throwing.
2. RED → confirm/extend the existing per-entry try/catch covers the new branch → GREEN → commit.
**Files likely touched:** mergeable-sweep.ts; sweep tests
**Dependencies:** 6

### Task 10: CiFixDispatchOpts seam + disabled-config inertness
**Story:** TR-3 happy (seam shape) + negative (disabled → no dispatch, sweep unchanged)
**Type:** infrastructure
**Steps:**
1. Failing tests: `SweepOpts` accepts optional `ciFix: CiFixDispatchOpts` ({enabled, isEligible,
   dispatch}); with `enabled: false` (or absent) and failed candidates present, `dispatch` is never
   invoked and registry writes equal the no-ciFix run.
2. RED → add the interface + candidate collection + enabled gate (mirror autoresolve pass
   structure, but over failed candidates) → GREEN → commit.
**Files likely touched:** mergeable-sweep.ts; sweep tests
**Dependencies:** 6

### Task 11: bump-before-dispatch persistence
**Story:** TR-3 happy (attempts+timestamp stamped in registry BEFORE dispatch); negative
(dispatch throws → counter persists, sweep survives)
**Type:** happy-path
**Steps:**
1. Failing tests: eligible entry → rewritten registry shows `ciFixAttempts+1` and `lastCiFixAt`
   even when the injected dispatch (a) resolves, (b) throws; throw is logged, not propagated.
2. RED → bump on the survivors entry before awaiting dispatch (mirror autoresolve AC3) → GREEN →
   commit.
**Files likely touched:** mergeable-sweep.ts; sweep tests
**Dependencies:** 10

### Task 12: one dispatch per tick
**Story:** TR-3 happy (second eligible entry deferred with logged reason)
**Type:** happy-path
**Steps:**
1. Failing test: two failed eligible entries → exactly one dispatch call; defer log line for the
   second; second entry's counter NOT bumped.
2. RED → `dispatched` flag (mirror autoresolve AC2) → GREEN → commit.
**Files likely touched:** mergeable-sweep.ts; sweep tests
**Dependencies:** 11

### Task 13: eligibility gates — cap, sticky label, CONFLICTING exclusion
**Story:** TR-3 negative (cap reached → no dispatch); TR-2 negative (needs-remediation
suppression); conflict-check resolution (CONFLICTING → skip, no burn)
**Type:** negative-path
**Steps:**
1. Failing tests on the new `isEligibleForCiFix(entry, state, cfg, now)`: attempts ≥ 2 →
   ineligible(reason: cap); labels include needs-remediation → ineligible(sticky); mergeable ===
   'CONFLICTING' → ineligible(conflict-precedence); each skip logged, no counter change.
2. RED → implement the gate chain in a new `ci-fix.ts` module (pattern:
   `autoresolve.ts#isEligibleForResolve`) → GREEN → commit.
**Files likely touched:** new src/conductor/src/engine/ci-fix.ts; its tests
**Dependencies:** 3, 4

### Task 14: eligibility gates — shared serial guard + cooldown
**Story:** TR-3 negative (any resolution in flight → defer without counter burn)
**Type:** negative-path
**Steps:**
1. Failing tests: `isResolutionInFlight()` true → ineligible(serial), attempts unchanged;
   `lastCiFixAt` within cooldown → ineligible(cooldown).
2. RED → reuse/export the autoresolve in-flight flag + cooldown check → GREEN → commit.
**Files likely touched:** ci-fix.ts; autoresolve.ts (export guard accessor); tests
**Dependencies:** 13

### Task 15: RETRY hint builder — happy
**Story:** TR-4 happy (hint names failing checks + includes log excerpt)
**Type:** happy-path
**Steps:**
1. Failing test (injected GhRunner): `buildCiFixHint(gh, cwd, prUrl)` — `gh pr checks --json` fake
   returns one failed check with a run link → hint string contains check name + excerpt lines from
   the faked `gh run view --log-failed` output (bounded length).
2. RED → implement in ci-fix.ts → GREEN → commit.
**Files likely touched:** ci-fix.ts; tests
**Dependencies:** none

### Task 16: RETRY hint builder — degradation
**Story:** TR-4 negative (log fetch fails → names + links, still proceeds)
**Type:** negative-path
**Steps:**
1. Failing test: `gh run view` throws / no run link present → hint contains check names + links,
   no throw, non-empty.
2. RED → degrade gracefully → GREEN → commit.
**Files likely touched:** ci-fix.ts; tests
**Dependencies:** 15

### Task 17: resolver worktree lifecycle from PR branch tip
**Story:** TR-4 happy (isolated worktree, stale cleanup, teardown both outcomes); negative
(worktree creation fails → non-throwing abort)
**Type:** happy-path
**Steps:**
1. Failing tests (temp git fixture repos, `git init -b main`): `runCiFix` fetches origin and runs
   its callback inside a worktree at the PR branch tip via `withResolveWorktree`; worktree removed
   after success AND after callback throw; branch-gone → aborts with logged reason, no throw, no
   primary-tree mutation.
2. RED → implement `runCiFix` scaffolding around `withResolveWorktree` → GREEN → commit.
**Files likely touched:** ci-fix.ts; tests
**Dependencies:** 13

### Task 18: fix-runner seam invocation
**Story:** TR-4 happy (fix run driven with RETRY hint)
**Type:** happy-path
**Steps:**
1. Failing test: injected fix-runner stub receives {worktreePath, hint, entry}; its result
   propagates to the dispatch outcome.
2. RED → define `CiFixRunner` seam (pattern: `RebaseResolver`) + production impl that shells the
   fix session (kill-switch guarded) → GREEN → commit.
**Files likely touched:** ci-fix.ts; tests
**Dependencies:** 15, 17

### Task 19: guards + suite gate before push
**Story:** TR-4 happy (guard-verified push to same branch) + negatives (suite-gate fail → no
push; lossy guard fail → no push)
**Type:** happy-path
**Steps:**
1. Failing tests: after a stub fix-run producing a commit — guards+gate pass → `pushRefreshed`
   invoked on the PR branch; suite gate fails → no push, outcome logged, attempt stays consumed;
   acceptance guards report lost commits → no push.
2. RED → chain `runAcceptanceGuards` + `runSuiteGate` + `pushRefreshed` in `runCiFix` → GREEN →
   commit.
**Files likely touched:** ci-fix.ts; tests
**Dependencies:** 18

### Task 20: primary-checkout leak assertion
**Story:** TR-4 negative (fix run must not dirty the primary checkout)
**Type:** negative-path
**Steps:**
1. Failing test: run the full `runCiFix` happy path against a fixture repo, then assert the
   primary checkout's `git status --porcelain` is empty and HEAD/branch unchanged.
2. RED (if scaffolding leaks) → fix → GREEN → commit.
**Files likely touched:** ci-fix tests
**Dependencies:** 19

### Task 21: exhaustion — escalation exactly once
**Story:** TR-5 happy (needs-remediation + upserted comment + HALT-grade event; sticky suppresses
repeats)
**Type:** happy-path
**Steps:**
1. Failing tests: failed entry with `ciFixAttempts: 2` → needs-remediation ensured+added,
   escalation comment upserted (content includes failing check names + attempt history),
   `ci_failed(exhausted)` event; next sweep with the label present → zero new gh mutations or
   events.
2. RED → implement exhaustion branch (reuse build-failure-escalation comment upsert) → GREEN →
   commit.
**Files likely touched:** mergeable-sweep.ts or ci-fix.ts; build-failure-escalation.ts (reuse);
tests
**Dependencies:** 13
### Task 22: exhaustion — failure and race negatives
**Story:** TR-5 negative (comment gh failure → label still applied, no throw; PR merged/closed
between detection and escalation → prune, no comment)
**Type:** negative-path
**Steps:**
1. Failing tests: comment call throws → label applied + logged + sweep resolves; state re-read
   MERGED → entry pruned, no escalation calls.
2. RED → order label-before-comment + tolerate comment failure; prune-first check → GREEN →
   commit.
**Files likely touched:** same as 21
**Dependencies:** 21

### Task 23: daemon-cli production wiring
**Story:** TR-3/TR-6 (config read once at startup; dispatch bound like autoresolve)
**Type:** infrastructure
**Steps:**
1. Failing test (daemon deps level): with ci_watch enabled, `sweepMergeableLabels` receives a
   populated `ciFix` opts whose dispatch invokes `runCiFix`; disabled → `ciFix.enabled` false.
2. RED → wire in daemon-cli.ts next to the `mergeable_autoresolve` binding (~1112) → GREEN →
   commit.
**Files likely touched:** src/conductor/src/daemon-cli.ts; wiring tests
**Dependencies:** 10, 19, 21
### Task 24: resolver real-binary smoke
**Story:** TR-4 Done-When (argv path exercised end-to-end; injected-runner tests are insufficient
per harness lesson)
**Type:** infrastructure
**Steps:**
1. Write a smoke test that runs the production fix-runner argv construction against a real
   `execa` spawn of a trivial binary (e.g. `true`/stub script), asserting spawn succeeds and args
   round-trip — no full Claude session.
2. RED → adjust argv builder if needed → GREEN → commit.
**Files likely touched:** ci-fix smoke test
**Dependencies:** 18

### Task 25: docs — README + conductor README + CHANGELOG
**Story:** TR-6 Done-When (docs track features)
**Type:** infrastructure
**Steps:**
1. Document `ci_watch.enabled` (default true, what the loop does, bounds, labels, escalation) in
   README.md + src/conductor/README.md; add CHANGELOG `[Unreleased]` → Added entry.
2. Commit "docs: ci_watch feedback loop".
**Files likely touched:** README.md; src/conductor/README.md; CHANGELOG.md
**Dependencies:** 23

### Task 26: structural guard scaffolding + git-init matcher
**Story:** TR-7 happy (flag `git init` without `-b`, all four exec shapes) + negatives (--bare/-b
exempt; commented-out lines exempt; empty-reason marker still flags) + falsifiability
**Type:** happy-path
**Steps:**
1. Write the new structural test file with: recursive glob over `src/conductor/test/**/*.ts`,
   comment-line exemption, `portability-ok` marker parsing (empty reason → still flagged), and
   embedded known-bad/known-good falsifiability fixtures for the git-init pattern (execa array
   form, execFile, exec/shell string, local git() helper).
2. Run it: it must FAIL on the current tree (16 real sites) — that failure list is the Task 27/28
   worklist. Commit the guard `.skip`-gated or on a fixture-only scope temporarily if needed to
   keep the tree green mid-plan (un-skip in Task 29).
**Files likely touched:** new src/conductor/test/structural/fixture-portability.test.ts
**Dependencies:** none

### Task 27: fix non-portable git init sites — batch 1
**Story:** TR-7b happy (sites pass -b main; semantics unchanged)
**Type:** refactor
**Steps:**
1. Fix the first 8 inventoried sites (engineer/* tests: authoring, authoring-guards,
   cross-repo-isolation, isolation, engineer-authoring, engineer-cli-handoff-writeback-failure,
   engineer-cli-land-owner, intake-marker) to `git init -b main` (or reasoned marker).
2. Run those test files — green. Commit.
**Files likely touched:** the 8 test files
**Dependencies:** 26

### Task 28: fix non-portable git init sites — batch 2 + portability spot check
**Story:** TR-7b happy (remaining sites) + negative (fixed test passes with
GIT_CONFIG_GLOBAL=/dev/null)
**Type:** refactor
**Steps:**
1. Fix the remaining ~8 sites (engineer-cli-handoff-branch-evidence, land-spec, track-marker,
   test/acceptance/engineer-isolation, shipped-work-dedup.acceptance,
   rekick-shipped-skip.acceptance, daemon-backlog, empty-ledger-replay-guard.integration).
2. Run one previously-non-portable test with `GIT_CONFIG_GLOBAL=/dev/null` and an
   `init.defaultBranch`-free env — green. Commit.
**Files likely touched:** the remaining test files
**Dependencies:** 27

### Task 29: unref + atomic-write matchers, guard fully armed
**Story:** TR-7 happy (unref flagged in src/engine/**; tmp-outside-target-dir flagged) +
falsifiability + daemon-log.ts annotation
**Type:** happy-path
**Steps:**
1. Add the two matchers with falsifiability fixtures; annotate the legitimate
   `daemon-log.ts:197` unref with a reasoned `portability-ok` marker; un-skip/arm the full guard
   over the real tree.
2. Guard green over the whole tree with zero unexplained exemptions. Commit.
**Files likely touched:** fixture-portability.test.ts; src/conductor/src/engine/daemon-log.ts
**Dependencies:** 26, 28

### Task 30: full-suite verification
**Story:** TR-7b Done-When (suite green with guard active); plan-level integration check
**Type:** infrastructure
**Steps:**
1. `npx vitest run` full suite in src/conductor — green, guard armed, no leaked-process or
   kill-switch violations.
2. Commit any stragglers; final "chore: ship-ci-feedback-loop plan complete" commit.
**Files likely touched:** —
**Dependencies:** 23, 24, 25, 29

## Task Dependency Graph

```
1 → 2
1,3 → 6 → 7
      6 → 8, 9, 10 → 11 → 12
3,4 → 13 → 14
       13 → 17
15 → 16
15,17 → 18 → 19 → 20
           18 → 24
13 → 21 → 22
10,19,21 → 23 → 25
26 → 27 → 28 → 29
26 ────────────↗
23,24,25,29 → 30
(5 feeds 8/21 event assertions; independent start nodes: 1, 3, 4, 5, 15, 26)
```

## Integration Points

- **After Task 12:** sweep-level behavior testable end-to-end with a stubbed dispatch (detection
  → label → bounded dispatch accounting).
- **After Task 19:** full remediation path testable against fixture repos (dispatch → worktree →
  stub fix → guards → push).
- **After Task 23:** daemon wiring complete — enable in a scratch repo and observe a synthetic
  red PR get a `ci-failed` label and one bounded fix attempt.
- **After Task 29:** guard armed; the tree is self-enforcing against the #384/#392/#393 class.

## Verification

- [ ] All happy path criteria covered by at least one task (TR-1: 1; TR-2: 6,7,8; TR-3: 3,10,11,12;
      TR-4: 15,17,18,19; TR-5: 21; TR-6: 4,23,25; TR-7: 26,29; TR-7b: 27,28)
- [ ] All negative path criteria covered by explicit tasks (TR-1: 2; TR-2: 8,9; TR-3: 10,11,12,13,14;
      TR-4: 16,17,19,20; TR-5: 22, 7 (recovery); TR-6: 4; TR-7: 26,29; TR-7b: 28)
- [ ] No task exceeds ~5 minutes of focused work
- [ ] Dependencies explicit and acyclic
- [ ] Task ids are bare numeric N; build agents stamp `Task: task-N` trailers (grammar #417)
