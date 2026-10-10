# ADR: The build loop runs the BUILD region once per stacked child, driven by a git-derived cursor

**Date:** 2026-10-07
**Status:** APPROVED
**Deciders:** James Stoup (operator; DECIDE decisions delegated to the composer session until the
spec PR, then reviewed on the PR), composer DECIDE session for jstoup111/ai-conductor#2942

<!-- Filename convention: adr-2026-10-07-<kebab-slug>.md (no sequential numbers). -->

## Context

#2942 is ticket 3 of the stacked child-plans chain (#2940–#2949). It builds on two shipped tickets:
- **#3019** gave the engine child identity and storage:
  - `feature-branch-identity.ts`, with child branches `feat/c<k>/<slug>` and the leaf
    `feat/daemon-<slug>`;
  - `child-context.ts`, with `ChildId` 1–9, `CHILD_REGION_STEPS` and `pipelinePathFor`;
  - child-capable gate verdicts and kickback ledger;
  - an optional event `child`;
  - recovery CLIs with `--child`.
- **#3039** gave plans story ownership and stack eligibility, recorded in the `coverage_binding`
  envelope.

The umbrella `adr-2026-10-03-stacked-child-plans-identity-and-state` fixed contracts (D4, D7–D11,
D13, D15) that this ticket must implement. Today nothing creates, switches or reads a child in the
loop, so an eligible stacked plan silently builds as one flat feature.

Facts (verified at `d5ca612e4a` unless marked):
- **The loop and its gates read flat state and whole-feature scope:**
  - selector and resume read `.pipeline/gates` and flat `conduct-state.json` (`selector.ts:46-59`,
    `conductor.ts` resume via `readAllVerdicts`);
  - the build predicate requires every plan task (`artifacts.ts:2858-2941`);
  - acceptance disposition grounding exact-covers the whole stories file (`artifacts.ts:1872-1947`);
  - spec attribution uses the default-branch merge-base (`artifacts.ts:3026-3066`);
  - build-review inputs take `merge-base(origin/<default>, HEAD)` (`build-review-inputs.ts:755-799`);
  - the FINISH fence and complete-verifier read flat test-suite evidence (`conductor.ts:3267-3287`,
    `complete-verifier.ts:49-57`).
- **The caps and the commit hook are whole-feature:**
  - `MAX_GATE_SELECTIONS` uses an in-memory map keyed by step name (`conductor.ts:1237`, `:15657`);
  - about ten callers hardcode the flat `ledger.gates.build_review` (conductor, `build-review-cli`,
    `rebase-transition`, `daemon-rekick`, `daemon-observe-cli`, `step-runners`,
    `remediation-case-effects`), and `updateKickbackLedger` takes no child;
  - the commit-msg hook validates a `Task:` id against the flat task-status only
    (`git-hook-assets.ts:544-639`).
- **The daemon creates the leaf at the base SHA** (`daemon-deps.ts:174-195`). Re-kick and every halt
  clear run a mandatory play-forward rebase of whatever is checked out (`daemon-rekick.ts:728`,
  `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` decision 5).
- **Halt records commit to the current branch and push it** (`halt-record.ts:130-134`, `:199`,
  `adr-2026-08-23-committed-halt-record` decision 5).
- **The rebase rewrite map is built and persisted** (`rebase-translate.ts:67`, `:324`).
- **The `coverage_binding` envelope is gitignored**, so worktree recreation loses it and
  `coverage_binding` re-seals it.
- **build_review's rubric container holds only `testQuality` and `security`**
  (`build-review-registry.ts:32`). No `boundTo` or Done-when binding exists in engine source, so
  `adr-2026-08-21-review-bound-by-plan-done-when-criteria` D2 is not on a live path.

Three adversarial reviews of the first draft found these blockers:
- ancestry-based closure closes child 1 on creation and reopens closed children after any rebase;
- `rewind --child` contradicts ancestry-based closure;
- a child that owns no story can never pass `acceptance_specs`;
- disposition-only is impossible for child 2 and later.

The decisions below incorporate the fixes.

## Options Considered

### Option A: Typed step instances `{kind, childId}` (filer hypothesis)
- **Pros:** the selector, laps and stuck-gate guard would be per-instance by construction.
- **Cons:**
  - 509 non-test `StepName` references;
  - the registry is built from config before the plan is known;
  - it contradicts the umbrella D8 directory-scoped stores the operator chose for #2940;
  - it fixes none of the git-closure, rebase or halt-record problems.

### Option B: Active-child cursor over the existing registry (chosen)
- **Pros:**
  - `StepName` and the registry are unchanged;
  - it reuses #3019's `child?` seams;
  - with no child, every read and write takes today's flat path, so N=1 stays structural.
- **Cons:**
  - every flat reader must be taught the active child;
  - a call site that forgets the child silently uses flat state. The overlay and port below
    centralize this.

### Option C: Nested child runner (a composite region step)
- **Pros:** the outer state machine is untouched.
- **Cons:**
  - build and test dispatch, retries and stall handling are inline in the conductor loop, so
    reusing them needs a large extraction;
  - it hides per-child verdicts that FINISH reads (`finish-publication-production.ts:576`);
  - it conflicts with #3019's `rewind --child`;
  - it fixes none of the git problems.

## Decision

1. **The cursor is derived from git and the sealed envelope, and closure is a monotone ref.**
   - **Positions:** the declared slice positions p1 < … < pN are read from the sealed
     `coverage_binding` envelope, never plan text (umbrella D5). When the first child is created,
     the engine also records them durably as a blob behind `refs/conductor/<slug>/positions`, written
     by compare-and-swap. That ref survives worktree recreation, so the position-immutability guard
     (decision 13) can compare against it.
   - **Closure:** when a non-leaf child pi closes, the engine writes
     `refs/conductor/<slug>/closed/c<pi>` by compare-and-swap `update-ref`, pointing at the child's
     tip.
     - The ref is outside `refs/heads`, is never pushed, and lives in the shared `.git`, so it
       survives worktree recreation.
     - Nothing but an explicit operator recovery removes it.
   - **Active child:** the lowest non-leaf position with no closure ref, and otherwise the leaf (pN).
     The leaf is never given a closure ref, so a whole-feature kickback can re-open its region.
     Whole-feature gates are selectable once the leaf's region is satisfied.
   - **Ancestry is only a divergence detector.** The engine halts needs-human, naming the child and
     "restack required (#2943)", in either case:
     - the closed child's branch has commits past its closure tip, other than commits that touch
       only its halt record;
     - the closure tip is not an ancestor of the next non-leaf child's branch. After the leaf's
       rebase, the tip is first translated through the persisted rewrite map.

     When the leaf contains neither the last intermediate child's closure tip nor its rewrite-map
     image, and no leaf rewrite map has been persisted, the leaf move is pending, not divergent.
     Once a leaf rewrite map exists, an untranslatable tip surfaces as `parent-not-ancestor` at the
     child-base sites (decision 8). A failing git invocation in the cursor fails closed, like
     detached HEAD. The leaf-move guard (decision 3) is retried at leaf entry, so an
     operator can clear a refused move and resume.
   - **The cursor is independent of the checkout.** Before any region dispatch the engine switches
     the worktree to the active child's branch.

   This amends umbrella D10, which read the checkout directly.

> **Amended 2026-10-10 by #2943:** Closure refs move by compare-and-swap inside a journaled restack transaction (decisions 4–5). A shared stack preflight recovers the restack journal and repairs commits appended past a closure (new cursor kind `repair-pending`) before the cursor is judged (decisions 7, 9); a rewritten closed child still halts. The cursor's leaf-rewrite-map-presence test is replaced by the `refs/conductor/<slug>/leaf-moved` ref (`adr-2026-10-10-stacked-restack-journaled-replay` decision 8).

2. **When there are children, and what happens when the envelope is missing.**
   - A feature has children only when all of these hold:
     - `stacked_prs.enabled` is true;
     - the sealed envelope records two or more positions;
     - #3039's stack eligibility passed, evidenced by the envelope's `storyOwnership` record, which
       only an eligible run writes.
   - A single-slice eligible plan builds flat.
   - Once any `feat/c*/<slug>` branch, closure ref or `.pipeline/children/` directory exists, the
     cursor uses them whatever the flag says. The flag gates only creating children.
   - "No child" is returned only when none of the three exist.
   - A region dispatch with child refs present and no sealed envelope halts needs-human.
     `coverage_binding` precedes the region and re-seals after a worktree recreation, so this is
     reached only on real corruption.

3. **Child branch creation, switching and the leaf move.**
   - **Creation** happens at the active child's region entry, only after:
     - `stacked_prs.max_slices` is re-checked;
     - the reserved `refs/heads/feat/c<k>` namespace is probed (umbrella D4).

     The ref is then created by compare-and-swap (`update-ref <ref> <sha> ""`):
     - child p1 at the leaf's tip at region entry. This equals the creation tip unless a pre-region
       halt record was committed to the leaf; child 1 then carries it, so the leaf has no commits of
       its own at the leaf move;
     - child pi+1 at child pi's closure tip.

     For the leaf there is no creation. Its start only emits `child_started` with branch
     `feat/daemon-<slug>`, after the leaf move below.
   - **Switching** is refused on a dirty tree, with the paths named. It never autostashes, and it
     resets `current-task`.
   - **The leaf move.** The leaf branch moves to child pN-1's closure tip by a compare-and-swap
     `update-ref`. This is allowed only when the leaf has no commits of its own
     (`rev-list <leaf> ^<tip pN-1> ^origin/<default>` is empty). Otherwise the engine halts
     needs-human.

> **Amended 2026-10-10 by #2943:** The leaf also moves inside a restack move transaction: when it is the active child, or when it is unentered and its tip lies inside a moved child's own range (for example a pre-region halt record), it moves to that commit's rewrite so the later leaf move sees no stray commit (decision 2) (`adr-2026-10-10-stacked-restack-journaled-replay`).

4. **Region state is read through an overlay and written through a routed port.**
   - Region step status, verdicts, test-suite evidence, acceptance evidence (the RED marker, run
     contract and disposition record), kickback-ledger gate entries and `build_review` remediation
     cases live under `.pipeline/children/<k>/` (umbrella D8). This adds the acceptance evidence
     files to D8's per-child list.
   - **Reads:** selector, resume, `checkGate`, `auto-resume`, `halt-clear`, the dashboard, daemon
     status, the FINISH fence, complete-verifier and `finish-publication-production` read one
     overlay: flat state plus the active child's region keys.
   - **Writes:** the conduct-state mutation port routes region keys to the active child's file
     (`adr-2026-08-01-conduct-state-mutation-port`).
   - **Kickbacks and stale cascades.** Every kickback, stale cascade and rebase invalidation that
     targets a region step writes to the active child. Whole-feature gates run only once every
     child is closed, so that child is the leaf.
     - Targets at or before `coverage_binding` keep today's behavior.
     - Routing a fix to its owning child is #2944.

5. **Acceptance specs are per child.**
   - The `writing-system-tests` skill receives the child's owned stories, projected from envelope
     `storyOwnership`.
   - Dispositions exact-cover only those stories' criteria.
   - Spec attribution uses the child's base (decision 8, a seventh base site).
   - A child that owns no story gets an engine-derived `no-owned-criteria` outcome, recorded in its
     verdict.
   - The RED rule is unchanged. A child-k spec that an earlier child already turned green is
     recorded through a new recorded-RED exception kind, `prior-child-green`. Its attribution names the
     parent child's closure tip, and the `writing-system-tests` skill records it the way the remediate
     skill records `remediation`. This amends
     `adr-2026-08-09-recorded-red-exception-for-remediation` D1. Per-spec RED attribution is not
     added.

6. **`build`, stall detection and the commit hook are per child.**
   - **`build`** completes when child k's slice tasks are resolved, plus the remediation tasks
     recorded to child k. Each remediation task's child is recorded at append, beside the
     appended-id record; it defaults to the active child.
   - `task-status.json` and `current-task` stay flat (umbrella D8).
   - **Stall detection** (`no_task_progress`) counts only child k's tasks. The
     commit-movement floor is unchanged: a stall still also requires that HEAD did not move
     (`adr-2026-07-23-commit-movement-liveness-floor` D1).
   - **The commit hook.** The commit-msg hook calls a blocking `ai-conductor task-membership-check`, the
     same way it already shells out for the scope check. Unlike the scope check, which only records
     containment and never blocks (`adr-2026-08-09-non-blocking-plan-scope-containment`), this check
     blocks: a cross-child commit puts one child's work into another child's PR, which is a
     correctness error rather than a containment signal. The check:
     - reads `git symbolic-ref`;
     - parses it with `feature-branch-identity`;
     - on a child branch, refuses a `Task:` id outside that child's membership (envelope projection
       plus recorded remediation tasks). It fails closed when membership cannot be read.

     Non-child branches abstain, so N=1 is unchanged. No marker file is consulted.

7. **`test_suite` is per child; the aggregate runs at the leaf.**
   - Evidence is written under the child, and `FullSuiteVerifier` takes a child-parameterized
     evidence path.
   - Scoped selection uses the child's base.
   - Under `full_suite: once`, the aggregate PASS is required once per feature, on the leaf: at the
     leaf's `test_suite` and at the FINISH fence. This was operator decision 2b.
   - Intermediate child tips get aggregate proof from each member PR's CI when #2945 publishes
     them. No child is published or mergeable before then.

8. **One base producer, consumed at seven sites.**
   - `resolveChildBase(worktree, child)` implements umbrella D11:
     - nothing, for no child or the first position;
     - the previous position's closure-ref tip. That tip equals the parent branch tip unless a halt
       record was committed past it;
     - typed `parent-missing`, when the parent has no closure ref;
     - new typed `parent-not-ancestor`.
   - **After the leaf's FINISH rebase,** the leaf's parent tip is translated through the persisted
     rewrite map. If it cannot be translated, the result is `parent-not-ancestor`.
   - **Sites:** build-review inputs, disposition, full-suite selection, autoheal, task seed,
     amendment claims, and (new) acceptance spec attribution.
   - Each site keeps its fail-closed policy. Acceptance attribution refuses disposition-only.

9. **`build_review` is child-local, and security runs once at the leaf.**
   - Each child's review grades the diff against its parent's tip (`baseKind: child-parent`).
   - The plan body stays whole, so a child-k test's `Covers:` can resolve to any task.
   - Remediation cases are per child.
   - **The `security` rubric** is skipped on non-leaf children, with skip reason `leaf-only`
     (distinct from `disabled`). On the leaf it grades a second
     frozen whole-feature snapshot, based on the default branch: each rubric projection takes its
     own snapshot (umbrella D15).
   - No line is graded twice by the same rubric.

10. **Caps are per child.**
    - The in-memory stuck-gate guard and recovery retries are keyed by `(step, child)`.
    - Every kickback-ledger caller passes the active child, and `updateKickbackLedger` gains a
      `child` parameter.
    - **Receipts:** a child gate's convergence-credit receipt is written in that child's ledger,
      atomically with the credit. This amends umbrella D8, which kept receipts flat.
    - Child ledgers refuse growth, `pendingRepair` and `effectiveGrowthCap`. Plan growth and repair
      budgets stay feature-wide.
    - **Total bound:** with N children, the `build_review` cumulative bound totals N×5 and the
      mechanical-fault bound N×3. Each child's own bound is unchanged.
    - **Halts:** a cap halt names the child, and its halt class maps per gate as today.
    - **Recovery:** `kickback-budget raise|reset --child` are offered, and re-kick's resume
      authorization reads the child's ledger.

11. **Operator surfaces.**
    - `rewind`, `task` and `kickback-budget` default `--child` to the active child.
    - `rewind --child k` for a closed child is refused, naming #2943, because re-running a closed
      child needs a restack.
    - Daemon status and the dashboard show the active child and its position, as `k/N`.
    - **Halt records** are committed to the active child's branch with a `Child:` field. They reach
      the leaf by ancestry.
      - A child branch is never pushed. `publishHaltRecord` and `escalateBuildFailure` refuse a
        child HEAD.
      - This replaces the umbrella's follow-up "halt records to the leaf". A plumbing commit on the
        leaf would give it commits of its own and block decision 3's leaf move.

> **Amended 2026-10-10 by #2943:** `rewind --child k` for a closed child stays refused; the refusal now names #2944, which owns closed-child re-validation (`adr-2026-10-10-stacked-restack-journaled-replay` decision 9).

> **Amended 2026-10-10 by #2846:** The `kickback-budget` default to the active child (decision 11) and the child-ledger recovery read (decision 10) apply to child-scoped gates. `coverage_binding` runs at or before the region (decision 4) and its existing-task reopen is a repair budget that stays feature-wide (decision 10), so its laps, cap evidence, adjustments, and resume authorization live in the feature ledger: `kickback-budget` resolves it there with or without children and refuses `--child` for it, and re-kick's resume-authorization sweep also reads the feature ledger for it (`adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` decision 6).

12. **Rebase guards until #2943.**
    - While the active child is not the leaf, `resumeRebaseFirst` and the base-advance re-kick
      rebase are skipped. The stack stays on its pinned base, and an event records the skip.
    - At the leaf, today's rebase applies to the leaf only.
    - This amends `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` decision 5 for
      stacked features.

> **Amended 2026-10-10 by #2943:** Lifted. The FINISH `rebase` step and the daemon re-kick base-refresh the whole existing stack at any active child, through the journaled restack; no single-branch rebase runs on a stacked feature and `rebase_skipped_for_stack` is no longer emitted for re-kick (`adr-2026-10-10-stacked-restack-journaled-replay` decision 9).

13. **Events and immutability.**
    - New `ConductorEvent` variants `child_started`, `child_closed` and `child_switched` are
      declared in `event-sinks.ts` with `persist: true`. They carry child, position and branch.
    - Region events carry `child` by conditional spread (umbrella D12).
    - The flat verdict lister and flat evidence probes stay flat, as umbrella D8 requires. The overlay
      (decision 4) is a separate reader.
    - `rebase_skipped_for_stack` records each decision 12 skip.
    - `coverage_binding` implements the position-immutability guard (umbrella D7): once any child
      exists, a reseal that moves, adds or removes a position halts needs-human. A re-run that
      re-owns a story without moving a task emits `story_reowned`.

14. **N=1 is unchanged.** With no child:
    - no ref is written;
    - the hook's membership check abstains with today's exit status (decision 6);
    - no event field or new event appears;
    - the overlay equals the flat state.

    #3019's golden suite must stay byte-identical, and new cells cover flag on with one slice and
    flag on with an ineligible plan.

> **Amended 2026-10-10 by #2943:** With no child, every successful feature-branch push records its tip under `refs/conductor/<slug>/pushed/<branch>` (decision 11); no other ref is written for N=1 (`adr-2026-10-10-stacked-restack-journaled-replay`).

## Consequences

### Positive
- Each child is built and validated as an independently green increment, in declared order, and
  survives restarts and worktree recreation without a new state file.
- Every #2942 follow-up in the umbrella ADR is implemented or explicitly re-decided here.
- The rebase and halt-record guards keep unpublished child branches off `origin` until #2945.

### Negative
- **The stack goes stale against main.** Children stay on their pinned base until the leaf's FINISH
  rebase. The default-branch drift lands in one rebase at the leaf.
- **More review laps.** With N children the total bound is N times higher (decision 10).
- **A gap in aggregate proof.** Intermediate child tips have no harness aggregate run until #2945's
  CI.
- **No per-spec RED attribution.** An already-green child spec needs the recorded-RED exception.

### Follow-up Actions
- [ ] #2943: restack, the cascade cap, re-validation after a restack, and lifting decision 12 and
      the decision 11 rewind refusal.
- [ ] #2944: route fixes to the owning child instead of the leaf (decision 4).
- [ ] #2945: publication, member CI, and lifting the decision 11 no-push guard for published
      children.

## Amendments made by this decision
- `adr-2026-10-03-stacked-child-plans-identity-and-state`: D8 (acceptance evidence and child
  receipts), D9 (total bound), D10 (cursor), D11 (`parent-not-ancestor`, seventh site), and the
  halt-record follow-up.
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` D2/D4: the marker is per child.
- `adr-2026-08-22-build-review-opt-in-rubric-container` D1: security is placed at the leaf.
- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` D4–D6: per-child evidence, and
  the aggregate runs once at the leaf.
- `adr-2026-07-23-trailer-union-build-step-routing` 1–2: the per-child task set.
- `adr-2026-08-12-cumulative-build-review-convergence-bound` D1/D3: the per-child cumulative bound.
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` D1/D4: per-child ledger gate entries.
- `adr-2026-07-11-verdict-aware-resume-entry`: resume reads the overlay.
- `adr-2026-08-23-committed-halt-record` decision 5: commit to the active child, never push a child.
- `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` decision 5: the stacked rebase
  guard.
- umbrella D13: recovery CLIs default to the active child, `raise`/`reset --child`, and the closed-child
  rewind refusal.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` D1/D3: the stacked default and
  refusal.
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` D4: the no-flag invariant is
  limited to features with no children.
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D4: the counter is per child.
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` D1/D2: the counters and
  refund apply to the active child's entry.
- `adr-2026-08-09-recorded-red-exception-for-remediation` D1: the `prior-child-green` kind.
- `adr-2026-07-21-demote-task-stamping-to-telemetry` D2/D3: the blocking membership check on child
  branches.
- `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility` D6: a missing envelope after
  worktree recreation is a re-run condition.
- `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` decision 6: the re-kick rebase
  contract applies at the leaf.
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` D2/D3: cap evidence and
  resume authorization per child.
- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` D5: scoped selection from the
  child base.
- `adr-2026-08-09-recorded-red-exception-for-remediation` D4: the self-heal uses the child's marker
  path.
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D5: the exhaustion HALT names the
  child.
- `adr-2026-08-23-committed-halt-record` decision 4: the record carries `Child:`.

`adr-2026-08-21-review-bound-by-plan-done-when-criteria` D2 is not amended, because no live engine
path implements it.
