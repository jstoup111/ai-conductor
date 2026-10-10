# ADR: Stacked child plans share one feature identity and keep per-child state beside it

**Date:** 2026-10-03
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer DECIDE session for jstoup111/ai-conductor#2940

<!-- Filename convention: adr-2026-10-03-<kebab-slug>.md (no sequential numbers). -->

## Context

Stacked delivery (#2940–#2949) builds a Medium or Large feature as up to five **children**. Each
child is a branch and later a PR, and the children are stacked on one feature identity. Today's
single-PR flow is the N=1 case. #2723 shipped the plan's `## Slices` manifest, `validatePlanSlices`
and the default-off `stacked_prs.enabled` key (`adr-2026-09-29-plan-slice-manifest`). This ADR is the
umbrella decision for the chain. It fixes how a child is named, recognized, identified and stored, and
how a child's base and events are expressed. It also fixes the contract later tickets implement.

Facts this rests on (verified at `833b75868` unless marked):

- **Branch identity is parsed in four private places.** `finish-record-cli.ts:275-288`,
  `halt-pr-reconciliation.ts:39-51`, `daemon-halt-pr-operations.ts:12,40-42` and
  `github-operations-cli.ts:83-88` each parse it, and `DAEMON_BRANCH_PREFIX` is defined twice.
  `feat/daemon-${slug}` is also hardcoded at `daemon-deps.ts:175`, `mergeable-sweep.ts:418` and
  `daemon-cli.ts:1998,2779`. A child branch fed to any of these is today mis-slugged, refused, or
  ignored. At `github-operations-cli.ts:85` that means every feature write is refused from a child.
- **Step state is one value per step.** `ConductState` is a flat `{[K in StepName]?: StepStatus}`
  (`types/state.ts:21-25`), and verdicts live at `.pipeline/gates/<step>.json`
  (`gate-verdicts.ts:125-129`). `StepName` appears at more than 300 sites, counting annotations, map
  keys and literal comparisons.
- **Base resolution has four deliberately different policies.** `build-review-inputs.ts`,
  `build-review-disposition.ts`, `full-suite-verifier.ts` and `autoheal.ts` share primitives in
  `rebase.ts`, but they differ in fetch and failure semantics: throw, fall back to the fresh base, run
  the aggregate suite, or widen the evidence range.
- **An unset optional event field is invisible.** The event persister spreads each event into
  `JSON.stringify` with no key sorting or hashing (`event-persister.ts:192-199`). An absent key
  therefore leaves `events.jsonl` byte-identical.
- **Slice positions can have gaps, and the count is capped.** Positions are positive integers with
  gaps allowed (`adr-2026-09-29-plan-slice-manifest` D3) and at most five slices
  (`MAX_PLAN_SLICES`, `plan-slices.ts:32`). `coverage_binding` records membership in its envelope
  (`coverage-binding-envelope.ts:31-34`). A drift test pins `plan-slices.ts` importers to land and
  `step-runners` (`test/engine/plan-slices-consumer-boundary.test.ts:148-167`).
- **There is one worktree per feature.** It switches between child branches (#2940 design, operator
  decision 8b). A feature ships only when the leaf PR merges (#2940 design §4.7).
- **Git ref names live in one namespace.** A branch named exactly `feat/c1` would block every
  `feat/c1/*` ref, and `feat/daemon-<slug>/c1` would conflict with the leaf. Verified in a scratch
  repository. `for-each-ref` matches patterns per path segment, so `feat/c*/*` would also match
  `feat/cool/x` (verified).

The hard constraint is that with no child (flag off, unsliced plan, or no child state)
every operator-facing output is byte-for-byte unchanged. That covers persisted state files, gate
verdict paths, events, daemon status and the dashboard, PR bodies, and shipped-record Cost and Time.

## Options Considered

### Option A: Typed step identity, `-c<k>` branches, one unified base resolver (the issue's hypothesis)
- **Pros:** Every step reference becomes explicitly child-aware, and it matches the original design
  sketch.
- **Cons:**
  - The step identity touches more than 300 `StepName` sites.
  - `feat/daemon-<slug>-c<k>` is ambiguous, because a real slug may end in `-c2`.
  - Unifying the four base policies changes three of them at N=1.

### Option B: Orthogonal child context, nested per-child stores, one branch parser (chosen)
- **Pros:**
  - `StepName` is unchanged.
  - Absence of a child selects today's paths, so N=1 byte-identity is structural.
  - Each base site keeps its policy.
  - Each per-child file is a whole copy of an existing schema, so parsers, leases and fail-closed
    rules are reused.
- **Cons:**
  - The child is a convention carried beside the step, not a type-level part of it.
  - Flat readers do not see child state until they are taught to (see Consequences).

### Option C: Git-config branch registry (`branch.<name>.conductorFeature`)
- **Pros:** No name parsing at all.
- **Cons:**
  - A second source of truth that drifts on manual branch operations.
  - Invisible on `origin`.
  - Every consumer, including leak triage and park, needs a lookup.

### Naming alternatives
`feat/daemon-<slug>--c<k>` is unambiguous only because today's slug generators never emit `--`.
`feat/daemon/<slug>/c<k>` keeps the daemon ownership marker and groups a feature's children.
`feat/c<k>/<slug>` was chosen by the operator.

### Storage alternatives
- **An optional `children` map inside the flat files.** This needs a new mutation grammar for the
  top-level-field state port (`adr-2026-08-01-conduct-state-mutation-port`).
- **Composite ledger keys (`build_review@2`).** This needs string parsing against the gate allowlist.

### Active-child alternatives for this ticket
- **Derive the active child from the checked-out branch now.**
- **Return "no child" while wiring every engine site.** This leaves code that no production input can
  reach.
- **Ship only what the recovery CLIs reach and fix the contract here (chosen).**

## Decision

1. **One owner for branch identity.**
   - A new `engine/feature-branch-identity.ts` is the only module that decides which feature a
     branch belongs to and in what role.
   - It returns a discriminated union: `leaf {slug}`, `child {slug, child}`, `spec {slug}`,
     `interactive {slug}`, or `unrecognized {raw, reason}`.
   - **Grammar:**
     - `feat/daemon-<rest>` is the leaf, with a non-empty, permissive remainder (today's rule).
     - `feat/c<k>/<slug>` is a child, where `k` is a `ChildId` (decision 5) and `<slug>` is a single
       non-empty path segment. The strict spec-slug rule is deliberately not used, because seven
       existing plan stems fail it.
     - `spec/<rest>` is a spec branch, and `feature/<rest>` is an interactive branch.
     - Anything else is `unrecognized`.
   - Prefix stripping (`refs/heads/`, `refs/remotes/<r>/`, `<r>/`) happens only in the enumeration
     consumer (intake overlap).
   - The module owns `LEAF_PREFIX`, `leafBranchFor(slug)` (a pure template, byte-identical to
     today's `feat/daemon-${slug}`), the validating `childBranchFor(slug, child)`,
     `isDaemonOwnedBranchName` (leaf prefix or child), and the ref globs.
   - The child globs are `refs/heads/feat/c[1-9]/*` and `refs/remotes/*/feat/c[1-9]/*`. Their hits
     are strictly re-parsed and invalid ones dropped before any further git call.
   - A drift test allowlists the migrated consumers. Out-of-scope `spec/` and `feature/` checks
     elsewhere are untouched.

2. **Every consumer keeps today's logic for every non-child input, and adds the child arm ahead of it.**
   - Non-child behavior is today's expression, moved verbatim into the identity module where it was
     shared. Parity is proven by table tests over every input accepted today, including degenerate
     ones: bare `feat/daemon-` and `spec/`, `feature/<x>`, trailing-hyphen slugs and nested remainders.
   - **Child arms in this ticket:**
     - **`finish-record` refuses a child** and names the child form. Recording a child PR as the
       feature's ship would be the false ship `adr-2026-07-07-finish-record-primitive` D3 forbids.
       #2945 lifts this.
     - **Halt-PR reconciliation** maps a child to its parent slug and probes the leaf for
       `.docs/shipped/<slug>.md`.
     - **Daemon halt-PR operations** map a child to its parent and require the leaf ref to exist.
     - **The GitHub-operations scope check** maps a child to its parent slug only when the leaf ref
       exists locally or on `origin`. `feature/<x>`, the bare prefixes and unrecognized branches keep
       today's raw-branch result.
     - **Intake overlap** adds the child globs and attributes a child to its parent slug.
     - **Park's shipped-record precondition** treats children as daemon-owned.
     - **Park never deletes a child branch.** When a parked feature's worktree lists a child branch,
       park refuses the whole candidate: it removes neither the worktree, which holds every child's
       state, nor the branch. The refusal uses a reason reserved for child branches and is counted as
       refused in the sweep summary. That refusal is evaluated before the shipped-record
       precondition, and record repair resolves an implementation PR only from the leaf head, never
       from a `feat/c<k>/` head, so a merged child PR can never mint the feature's shipped record. On
       the branch-undefined path a child branch is never deleted.
       Stack teardown is #2945's.
     - **Teardown, worktree creation and the shipped-record probe** use `leafBranchFor`.
   - Leak triage, the dashboard and `ensureWorktree` need no change.

3. **Attribution is not authority.**
   - A structural parse only attributes a branch to a feature.
   - A side effect still needs that consumer's existing gate: the committed owner check
     (`adr-2026-09-11-github-operation-ownership` D2), the shipped-record precondition, or
     ancestry/merged-PR proof.
   - The leaf-exists check is added wherever a child can trigger a GitHub write.
   - So a hand-made `feat/c1/<x>` branch gains no more than a hand-made `feat/daemon-<x>` has today.

4. **`feat/c<k>` is a reserved namespace.**
   - The parser never recognizes the bare `feat/c<k>`.
   - The ticket that first creates child branches (#2942) must probe for a conflicting
     `refs/heads/feat/c<k>` before creating `feat/c<k>/<slug>`, and refuse with that ref named.

5. **A child is identified by its declared slice position, under a fixed ceiling of nine.**
   - `ChildId` is a branded integer in 1..`MAX_CHILD_ID`, built only by `parseChildId`.
   - `MAX_CHILD_ID` is a fixed engine ceiling of 9, defined in the child-context module.
   - Branch recognition never depends on configuration. Otherwise a config change would orphan
     existing child branches and state.
   - "No child" is always `undefined`, never `null` or `0`.
   - The source of a feature's children is the `coverage_binding` envelope's slice membership, never
     plan text. No production module this feature adds or changes imports `plan-slices.ts` (the existing land and `step-runners` callers named by `adr-2026-09-29-plan-slice-manifest` D2 stay its only importers), and production source never uses the
     capitalized slice-section token the drift test reserves.
   - **The maximum number of slices for stacked delivery is an operator config key,
     `stacked_prs.max_slices`:**
     - the default is 1;
     - values 1–9 are accepted, values above 5 log a warning, and 10 or more is a `validation_error`
       naming the key;
     - it is enforced where children come into being: land (#2941) and child creation (#2942);
     - #2941 implements the key where land consumes it, replacing the fixed `MAX_PLAN_SLICES`
       constant. This amends `adr-2026-09-29-plan-slice-manifest` D3, which made the bound "a code
       constant equal to 5, not a config key";
     - a drift test keeps the land bound no greater than `MAX_CHILD_ID`.
   - A plan with a slice position above 9, or with more slices than the configured maximum, is not
     accepted for stacked delivery. #2941 decides the land behavior.

> **Amended 2026-10-07 by #2941:** (adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility
> decision 7) The land behavior is decided: `stacked_prs.max_slices` is enforced through the
> flag-on stack-eligibility verdict at land and `coverage_binding`, and `MAX_PLAN_SLICES` is replaced
> by the `MAX_CHILD_ID` ceiling in the flag-independent grammar rung.

6. **The leaf is a branch kind, not the absence of a child.**
   - When a feature has children, the leaf is the child with the highest declared position. Its
     region state lives under that child's directory, and its branch stays `feat/daemon-<slug>`.
   - Every other position `p` is `feat/c<p>/<slug>`.
   - With no children, the leaf has no `ChildId` and uses today's flat paths.

7. **Positions are immutable once any child exists.**
   - After any `.pipeline/children/<k>/` or any `feat/c<k>/<slug>` exists for a feature, its declared
     slice positions must not change.
   - A reseal that would move, add or remove a position halts needs-human instead of silently
     re-attributing state. The guard belongs in `coverage_binding` and is implemented by the ticket
     that first creates children (#2942).

8. **Per-child state lives under `.pipeline/children/<k>/`, mirroring the flat layout.**
   - One seam, `pipelinePathFor(root, relative, child?)`, forms every per-child path.
   - Each per-child file is a whole copy of the existing schema, with the same parser, lease and
     fail-closed rules. There are never composite keys and never nested maps inside flat files.
   - **Region stores**, the ones that may be per-child:
     - step status, in `children/<k>/conduct-state.json`. It holds region step keys and a
       `last_step` recording that child's position in the step registry, set the way today's rewind
       sets it, through the same mutation port;
     - gate verdicts for `acceptance_specs`, `build`, `test_suite` and `build_review`;
     - kickback-ledger gate entries for those steps;
     - test-suite evidence (#2942);
     - `build_review` remediation cases (#2942).
   - **Whole-feature state never moves:** `coverage_binding`, `manual_test`, `prd_audit`, as-built,
     rebase, finish, HALT, code stamps, repair obligations, `current-task`, `task-status.json`, ledger
     growth, receipts and pending repair, PRD-widening cases, and suppressions.
   - **Flat enumerations never descend into `children/`.** The fresh-session ledger clear removes each
     existing `children/<k>/kickback-ledger.json` by explicit enumeration, never with a recursive
     delete (`adr-2026-07-11-pipeline-state-durability` D2).

> **Amended 2026-10-07 by #2942:** The region stores also hold acceptance evidence (RED marker, run contract, disposition record), and a child gate's convergence-credit receipt is written in that child's ledger atomically with the credit; growth, `pendingRepair` and `effectiveGrowthCap` stay flat and child ledgers refuse them (`adr-2026-10-07-per-child-build-region` decisions 4 and 10).

9. **Region caps apply per child.**
   - Because region gate entries, including `build_review`'s cumulative count, live in the child's
     ledger, every region cap applies per child. That is the operator's decision log ("caps are per
     child, none at the leaf").
   - Enabling this is #2942's, and so is amending the cap scope in
     `adr-2026-08-12-cumulative-build-review-convergence-bound` and
     `adr-2026-07-26-cross-dispatch-kickback-livelock-bound`.
   - Plan growth and repair budgets stay feature-wide (#2944).

> **Amended 2026-10-07 by #2942:** Per-child caps are enabled. With N children the total `build_review` cumulative bound is N×5 and the mechanical-fault bound N×3; `kickback-budget raise|reset --child` are offered (`adr-2026-10-07-per-child-build-region` decision 10).

10. **The active-child contract is implemented by #2942.**
    - The active child is derived from git branch state, with no new state file, so it survives
      worktree recreation (#497):
      - a checked-out `feat/c<k>/<slug>` is child k;
      - the leaf branch while child branches exist is the highest declared position;
      - otherwise there is no child.
    - It must never resolve to "no child" in a way that would write region state to the flat paths
      while child state exists. #2942 decides the fail-closed policy for detached HEAD and git errors.
    - In this ticket the active child is always "no child".

> **Amended 2026-10-07 by #2942:** The active child is derived independently of the checkout: positions from the sealed envelope, closure from monotone compare-and-swap refs `refs/conductor/<slug>/closed/c<k>`, active = lowest unclosed position; ancestry is only a divergence detector. Ancestry-based or checkout-based derivation was falsified by adversarial review (child 1 closed on creation; closed children reopened by rebase). The engine switches the worktree to the active child before any region dispatch (`adr-2026-10-07-per-child-build-region` decisions 1–2).

11. **The base-override contract is implemented by #2942.**
    - One producer, `resolveChildBase(worktree, child)`, returns one of three results:
      - nothing, for no child or the first declared position, so today's per-site ladder runs;
      - the local tip of the previous declared position's branch, for later positions. It never
        fetches or calls `ls-remote`. Previous-position parenthood follows
        `adr-2026-09-29-plan-slice-manifest` D4;
      - a typed parent-missing result.
    - Each site consumes the producer's result before its existing ladder and keeps its own policy.
      The ladders are not unified. When the parent is missing, each site fails closed:
      - build-review inputs: `MergeBaseError`;
      - disposition: the existing catch;
      - full-suite selection: aggregate run;
      - autoheal: no commits, instead of the `-n 100 HEAD` widening;
      - task seed: nothing proven;
      - amendment claims: all obligations.
    - `BuildReviewInputs.baseKind` gains `child-parent`, which suppresses the degraded-fetch warning.

> **Amended 2026-10-07 by #2942:** `resolveChildBase` gains a typed `parent-not-ancestor` result (and translates the leaf's parent tip through the persisted rewrite map after its FINISH rebase), and acceptance spec attribution is a seventh consuming site that refuses disposition-only when the parent is unresolvable (`adr-2026-10-07-per-child-build-region` decision 8). The follow-up "write halt records to the leaf" is re-decided: halt records commit to the active child's branch with a `Child:` field and reach the leaf by ancestry; no child branch is pushed (decision 11).

12. **Events carry an optional `child`.**
    - `ConductorEvent` becomes `(existing union) & { child?: ChildId }`.
    - Emitters add the key only when a child is present (conditional spread), never `child:
      undefined` or `null`.
    - Rollups ignore it, so shipped-record Cost and Time stay once per feature.
    - In this ticket `operator_rewind` carries it.

13. **The recovery CLIs take `--child <k>`.**
    - `--child` is accepted only for a valid `ChildId` whose `.pipeline/children/<k>/` already exists.
      A flag-off feature with a sliced plan therefore cannot gain child state.
    - Without the flag, each command uses no child and behaves exactly as today. #2942 changes that
      default to the active child (decision 10). Every malformed form behaves exactly as that
      command's malformed forms do today: the unknown-command text for `rewind` and
      `kickback-budget`, and the task guidance (exit 2) for `task`.
    - **`rewind --to <step> --child k`:**
      - The target must be a region step.
      - It demotes child k's region from the target, every region step of each existing child above
        k, and every downstream whole-feature step. It never touches children below k.
      - Each change is an authorized mutation through the port. It clears those steps' verdicts and
        clears HALT as today.
    - **`task --child k`** validates the task's membership against k and writes nothing new.
      `current-task` stays flat because the commit hook reads it.
    - **`kickback-budget inspect --child k`** reads child k's ledger entries. `raise` and `reset` with
      `--child` are not offered until #2942 writes per-child cap evidence.

> **Amended 2026-10-07 by #2942:** Without `--child`, `rewind`, `task` and `kickback-budget` now default to the active child of a feature with children; byte-identity without the flag holds for features with no children. `kickback-budget raise|reset --child` are offered. `rewind --child k` for a closed child is refused naming #2943, and the downstream cascade over children above k applies only to children that are not closed (`adr-2026-10-07-per-child-build-region` decisions 10–11).

> **Amended 2026-10-10 by #2943:** `kickback-budget raise|reset --gate restack --child <k>` is the one exception: it validates `<k>` against `refs/conductor/<slug>/cascades`, not `.pipeline/children/<k>/`, so cascade-cap recovery survives worktree recreation (`adr-2026-10-10-stacked-restack-journaled-replay` decision 10).

14. **The N=1 contract is structural and proven by golden tests.**
    - With no child there is no `children/` directory, no new key, and no event field.
    - A golden suite of committed fixture files, recorded from the pre-change base, is added in the
      plan's first task before any production change. It covers:
      - persisted state files, the gate verdict path set, `events.jsonl` and the kickback ledger;
      - `rewind`, `kickback-budget`, daemon status and the dashboard;
      - the PR body;
      - the shipped-record Cost block.

      Each surface runs in three cells: flag off, flag on with an unsliced plan, and flag off with a
      sliced plan.
    - Only timestamps and the fixture root are normalized, and git dates are pinned.
    - Interval timings, and the shipped-record Time block derived from them, are not golden-tested.
    - The four parser migrations are proven by table-driven parity tests.

15. **A whole-feature rubric runs once, at the leaf.**
    - In a stacked feature each child's `build_review` runs every enabled rubric on that child's own
      diff, except a rubric whose question is about the whole feature.
    - The `security` rubric is such a rubric. It grades "the whole feature diff since the merge base"
      (`adr-2026-08-22-build-review-opt-in-rubric-container`, as amended by #2034), so it runs once,
      at the leaf, over the whole-feature diff.
    - No line of code is graded twice by the same rubric.
    - #2942 implements this placement.

## Consequences

### Positive
- Every later ticket builds on one identity, one storage seam and one event field, and on contracts
  approved here rather than re-derived.
- N=1 identity does not depend on every writer remembering a rule, because the absence of a child
  selects today's code path.
- A child branch can no longer be refused at ship, mis-attributed by intake overlap, or deleted by
  park reconciliation. The re-dispatch-forever failure (#438) and the leaked-stack failure are closed
  before any child exists.
- Each base site keeps its failure semantics, so N=1 grading, scoped-suite selection and autoheal
  windows are untouched.

### Negative
- The child travels beside `StepName`, so a call site that forgets to pass it silently uses the
  feature's flat state. Per-store tests and #2942's wiring review mitigate this.
- **Flat readers are blind to child state.** Once a feature has children, these readers see no region
  verdicts or region step status until #2942 makes them active-child-aware:
  - `readAllVerdicts` callers `conductor.ts:7117`, `14643`, `14781` and `14855`;
  - `finish-publication-production.ts:576`;
  - `selector.ts:46-59`, `resume.ts:39`, `auto-resume.ts:58`, `halt-clear-cli.ts:85` and
    `daemon-dashboard.ts:348`.

  This is safe here only because nothing creates children yet.
- `feat/c<k>/<slug>` lives outside the `feat/daemon-` namespace, so ownership checks rely on the
  identity module rather than a prefix (decisions 1 and 3).
- A plan with a slice position above 9 cannot be stacked. Stacking also needs the operator to
  raise `stacked_prs.max_slices` from its default of 1.

### Follow-up Actions
- [ ] #2941: add the `stacked_prs.max_slices` config key (default 1, warn above 5, refuse 10 or
      more), replacing the fixed land bound, and refuse stacked delivery for a manifest above the
      configured maximum or with a position above 9 (decision 5).
- [ ] #2942: implement active-child resolution (decision 10) and engine-site child wiring.
- [ ] #2942: implement the base-override producer and site consumption (decision 11).
- [ ] #2942: make test-suite evidence and `build_review` remediation cases child-capable
      (decision 8).
- [ ] #2942: enable per-child caps and amend the cap scope (decision 9).
- [ ] #2942: make every flat reader listed above child-aware.
- [ ] #2942: add the position-immutability guard (decision 7) and the reserved-namespace probe
      (decision 4).
- [ ] #2942: place whole-feature rubrics (security) at the leaf only (decision 15).
- [ ] #2942: write halt records to the leaf with a `Child:` field (re-homed by the operator).
- [ ] #2942: offer `kickback-budget raise`/`reset --child`.
- [ ] #2945: lift finish-record's child refusal, add the child→PR map, and remove child branches at
      teardown and reclaim only after the leaf merges.
- [ ] #2943/#2944: amend the remaining ADRs listed in the #2940 design §6 when their behavior lands.

> **Amended 2026-10-10 by #2943:** The #2943 follow-up (restack) is delivered by a journaled off-worktree replay. Re-validating closed children moved by a restack, re-validating a repaired closed child, and the closed-child rewind move to #2944 (`adr-2026-10-10-stacked-restack-journaled-replay`).
