# ADR: Whole-feature repairs are routed to the owning stacked child through a ref-backed route record

**Date:** 2026-10-12
**Status:** APPROVED
**Deciders:** operator (James Stoup), with adversarial review by subagents (Claude ×5, Codex ×3 across
explore, diagrams and this ADR)

## Context

#2944 is ticket 5 of the stacked child-plans chain (#2940–#2949). The chain design is in #2940; the
diagrams are in `.docs/architecture/whole-feature-audit-fixes-cannot-land-in-the-stack.md`. It builds
on four shipped tickets:
- `adr-2026-10-03-stacked-child-plans-identity-and-state`: identity and per-child state;
- `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`: slices and story ownership;
- `adr-2026-10-07-per-child-build-region`: the per-child BUILD region;
- `adr-2026-10-10-stacked-restack-journaled-replay`: the journaled multi-branch restack.

`manual_test`, `prd_audit`, `architecture_review_as_built` and post-region custom steps run once, on
the leaf, over the whole implementation (#2940 operator decision; sliced-plan ADR decision 3). Their
admitted fixes must land in the child whose work they correct, because reviewers read and request
changes on specific child PRs. The manual landing aid and the closed-child rewind were split to
#3203 by operator decision; this ADR is the machinery #3203 builds on.

Verified facts at the spec base (paths relative to `src/conductor/src/engine/`):
- **Every remediation is owned by the leaf today.**
  - Appended rem-* ids are recorded with `activeRegionChild` (`recordAppendedRemediationTaskIds`,
    `artifacts.ts`), which is always the leaf at a whole-feature gate.
  - The rem blocks are written to the single plan and committed on HEAD
    (`commitEngineChangeWhenStacked`). A failed commit only logs a warning.
- **A non-halt commit past a closed child's closure is already a repair.**
  - `resolveActiveChild` (`child-cursor.ts`) reports `repair-pending`. The stack preflight then
    runs a `feature-repair` restack, which moves the closure to the branch tip (restack ADR
    decisions 7 and 9).
  - The planner derives the originating children itself: every closed child with non-halt commits
    (`restack/restack-plan.ts`). `runRestack` ignores a caller-supplied origin.
- **A restack is several transactions, not one.** `ready`, `moved` (branches, closures,
  `leaf-moved`), `synced`, then `applied` with the cascade count
  (`restack/restack-move.ts`, `restack/restack-executor.ts`). `wouldInvalidate` for closed children
  is computed only at the transition after `synced` (`restack/restack-transition.ts`). It counts a
  gate only if that child's `.pipeline` verdict reads satisfied. A rollback restores branches and
  closures only.
- **Region state is per child and stays `done` after closure.** Activating a closed child's overlay
  (`activateChildRegionState`, `conductor.ts`) shows its region steps as done. Navigating the leaf
  back to `build` restages only the leaf's.
- **The cursor kind is enumerated by consumers.** The restack executor's `activeFor` throws on any
  kind other than `active` or `repair-pending`. These consumers read `cursor.child`, which is the
  leaf:
  - `activateChildRegionStateForResume` and region entry (which accepts only `active`);
  - `task-cli`, `kickback-budget-cli` and `rewind`;
  - `daemon-rekick`.
- **The repair budget is feature-wide but lives only in `.pipeline/`.**
  - `pendingRepair` and `growth` are in the flat `kickback-ledger.json`. Settlement fires at any
    `build` dispatch (`settleBuildPendingRepair`).
  - The growth denominator is re-derived from the single active plan, and is reconciled against
    stored growth.
  - `manualTestSelfHeals` is a process-local counter (`conductor.ts`).
  - `.pipeline/` does not survive worktree recreation (#497); restack ADR decision 10 rejected it
    for cascade counts for that reason.
- **Repair obligations assume one branch.** The boundary is the HEAD at admission and the admission
  key includes HEAD and plan path (`repair-restage.ts`). Resolution reads `Task:` trailers in
  `baseline.head..HEAD` (`task-progress.ts`, `autoheal.ts`).
- **A `manual_test` FAIL is not a remediation append.** `handleManualTestFailKickback` rewinds to
  `build` with the FAIL rows as a retry hint and charges its own counter. It creates no task and no
  receipt. In a validation group, FAIL rows and gaps join one consolidated work order
  (`adr-2026-07-10-validation-group-join` decision 3).
- **Story ownership is total.** Land refuses a story whose tasks span children
  (`deriveStoryOwnership`, `plan-slices.ts`). Every task-bound finding therefore has exactly one
  owning child (`taskSlices` in the sealed coverage-binding envelope).
- **Event dedup is per type.** The persister deduplicates only a few observation types
  (`event-persister.ts`).

## Options Considered

### Option A: LLM routes every finding (the filer's sketch)
- **Pros:** one uniform mechanism.
- **Cons:** a schema-valid answer can contradict explicit task ownership, which machinery already
  knows. It adds an LLM call to every lap, including N=1. Re-opening a closed region by removing its
  closure breaks `resolveChildBase` for the child above and bypasses the cascade cap.

### Option B′: Mechanical owner routing, judgement only for the residue (chosen)
- **Pros:** task-bound findings route with zero judgement. Judgement is confined to genuine
  judgement calls, each schema-constrained and verified. N=1 has no added cost.
- **Cons:** it needs new durable state, a cursor field, an execution-child resolver, and a
  re-ordering of admission, settlement and region exit.

### Option C: Fix on the leaf, then sink the commits down
- **Pros:** no change to the remediation loop.
- **Cons:** the owning child never builds or tests the fix. The leaf contains every child's code, so
  it cannot detect a missing prerequisite. It adds a second history transformation beside the
  journaled replay, and violates "recorded before mutation".

## Decision

Option B′. Machinery does the bookkeeping, and judgement is used only where the question is one
(CLAUDE.md design principle).

1. **Routing is entered only for a feature with durable child state, and classification runs
   first, unchanged.**
   - `resolveActiveChild` establishes stacked eligibility before any routing ref is probed. On
     `no-child`, today's leaf remediation and kickback paths run byte for byte.
   - A feature that already has children keeps routing even if `stacked_prs.enabled` is later
     turned off, as the cursor does today.
   - PLAN_GAP, DESIGN, OVER_SCOPE, malformed-evidence and no-owner findings halt or refuse exactly
     as their governing ADRs say, whether or not an implementing child exists.
   - Admitted work has two kinds:
     - **Task work orders:** `prd_audit` FIXABLE, as-built REMEDIABLE, refusal rework and merged
       `/remediate` gaps. They append rem-* tasks or restage an existing task, as today.
     - **Taskless obligations:** a `manual_test` FAIL and a post-region custom-step kickback. They
       rewind to `build` with their retry hint and append no task.

   > **Amended 2026-10-24 by #3203:** Routing is also entered by an operator command, with no finding to classify: `stack land` and the closed-child `rewind` open a round of kind `operator` on a closed child (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decisions 1, 5 and 11).

2. **Owner derivation is mechanical for task-bound work.**
   - A finding bound to an authored task routes to `taskSlices[taskId]` from the sealed envelope.
   - A finding bound to a rem-* task routes to that block's committed `**Child:**` line
     (decision 9).
   - No judgement is consulted, and none can override a task-bound owner.

3. **Residue routing is one engine-owned judgement, outside the gate verdicts.**
   - The residue is:
     - an as-built REMEDIABLE finding citing only `<adr-stem> D<n>`;
     - refusal rework;
     - a standalone taskless obligation.
   - The engine makes one routing call per round, inside remediation planning. Its own schema
     returns per item `{child, candidates[], rationale}`, and it has its own retry budget of one
     re-ask. The gate verdict schemas and their versions are unchanged. The call only places work
     that has already been admitted; it never supplies an operator decision.
   - `child` and every candidate must be declared slice positions.
     - An ambiguous answer, or one naming several candidates, routes to the earliest candidate with
       reason `residue-default` (#2940 operator decision 4b).
     - An invalid answer, after the re-ask, halts needs-human naming the item. No position is
       guessed.
   - **Mixed rounds.** When a consolidated work order (`adr-2026-07-10-validation-group-join`
     decision 3) carries both task-bound gaps and FAIL rows, no judgement is made:
     - the FAIL obligation routes to the earliest task-owned host in the round;
     - the FAIL rows ride every host's retry hint as evidence;
     - existing-task gaps ride their host's retry hint without a restage, as today's consolidated
       dispatch does.

4. **Owner and host are separate; the host moves upward only on evidence.**
   - The **host** is the child that builds the fix. It defaults to the owner. The host branch is
     resolved through `feature-branch-identity`, never by string assembly.
   - **Prerequisite inputs versus outputs.** The cited paths are those named by the work order's
     Done-when criteria, its finding evidence and the owner task's declared files.
     - A cited path present at the leaf tip is a **prerequisite input**.
     - A cited path absent at the leaf tip is an **output** the repair creates. Its absence is never
       prerequisite evidence.
   - **Cannot-host before mutation (mechanical).** If any prerequisite input is absent from the
     owner's closure tree, the host becomes the earliest closed child **above the owner** whose
     closure tree contains **every** prerequisite input, with reason `prerequisite-paths`. If none does, the leaf's tip
     is checked. If the leaf also fails, the round halts needs-human, naming the missing paths.
   - **Leaf host.** The leaf has no closure, and its "closure tree" in every check is its tip.
     - In a stacked round, the leaf is an explicit host entry with states `pending`, `admitted`,
       `repairing` and `done`.
     - Its blocks are part of the frozen allocation and are appended at its region entry. The
       flat `pendingRepair` is never written for it, so it cannot be charged twice.
     - It requests no restack. Leaf-hosted items are always processed last in a round.
     - Returning to the leaf, after the last child host or queue entry, switches the worktree to the
       leaf branch. The switch is idempotent and recorded in the route record before the round is
       `closed`.
   - **Execution projection.** Authored slice membership never changes. While the route is open,
     the route record lets the host complete or repair the routed tasks, including an
     `existing-task` repair of the owner's task. Task scope, task-status seeding, the membership hook
     and `task-cli` all honour it by reading the route record.
   - A test failure is never evidence that a child cannot host a fix.

5. **A builder may claim a missing prerequisite, and the engine verifies it before re-routing.**
   - During a routed build, the builder may return a schema'd
     `blocked-by-prerequisite {paths[] | symbols[], child}`.
   - The engine verifies that each cited path or exported symbol is absent at the host's closure
     and present at the named child's closure (the leaf's tip if it names the leaf). It also
     verifies that the destination holds every prerequisite input from decision 4. A child that is
     not strictly above the host is refused.
   - **Verified.** In order:
     - The reroute is refused (needs-human) while a restack journal is non-terminal, or if the host
       branch has any commit past its closure that is neither stamped with this round's id nor
       halt-record-only. While a marker is set, the commit hook stamps `Round: <roundId>` on every
       commit on the host branch, beside the engine-stamped `Task:` (#433 precedent). So builder
       commits never trip the refusal.
     - One `update-ref --stdin` transaction:
       - pins the rejected tip under `refs/conductor/<slug>/rejected/<roundId>/<n>`, a sibling namespace, because git cannot nest refs under the `routes/<roundId>` blob ref;
       - compare-and-swaps the host branch back to its closure;
       - moves the marker to the new host;
       - advances the route record with fallback `{from, to, evidence}` and phase `reroute-moved`
         `{source branch, rejected tip, reset tip, destination}`. That includes re-targeting the
         open repair obligations (decision 11).
     - The checked-out tree is then synced by `read-tree -m -u` from the rejected tip to the reset
       tip, following the restack-sync precedent. Then the destination is `admitted`.
     - A resume that finds `reroute-moved` completes the guarded sync before any admission or
       dispatch.
     - The same task ids and bodies are re-materialised on the new host with its `Child:` line, and
       no budget is charged again.
   - **Not verified:** the claim is an ordinary failed build attempt within the host region's caps.
   - Reroutes move strictly upward, so a round has at most N−1.

   > **Amended 2026-10-24 by #3203:** Prerequisite claims are disabled in an `operator` round, so no reroute can move or reset an operator's change (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decision 1).

6. **A ref-backed route record is the authority for a routing round.**
   - **Where.** `refs/conductor/<slug>/routes/<roundId>`, a blob ref written only through
     `update-ref --stdin` compare-and-swap. This follows the `cascades` precedent; the non-CAS
     `leaf-moved` writer is not a precedent. It is exception-C durable state under the event-spine
     skill.
   - **Kinds.** `audit` (decisions 1–5) and `revalidate` (decision 14).
   - **Teardown.** Shipped-record teardown and reclaim delete by explicit name, never by glob, every
     ref this ADR creates:
     - each `routes/<roundId>` and each `rejected/<roundId>/<n>` pin;
     - `repairing` and `revalidate`;
     - each `red/c<k>`.

     They are listed with the restack ADR's teardown refs.
   - **Writers during a restack.** Outbox drains finish before an exit restack's journal is created.
     While any restack journal is non-terminal, every route-record writer other than that restack is
     refused, so the `applied` transaction's compare-and-swap cannot be invalidated.
   - **What it holds:**
     - every routed item: finding identity, kind, owner, host, reason and fallback chain;
     - the **frozen allocation**: every rem-* id and block body for every host, computed at
       admission against the union of the leaf's plan and every host plan;
     - **per-host state** (`pending`, `admitted`, `repairing`, `reroute-moved`, `built`,
       `restacked`, `done`, and the terminal `rerouted` for a host a verified reroute moved away
       from, which host selection never picks again), the index of the current host, and the
       round's terminal phase `closed`;
     - the round receipt (decision 10);
     - the event outbox (decision 16).
   - **Phase writers and crash recovery:**

     | Phase | Written by | Recovery when found on resume |
     |---|---|---|
     | `prepared` (round) | gap loop, before any mutation | no marker: abort, nothing mutated |
     | host `admitted` | marker transaction (decision 7) | re-navigate to the host region sentinel |
     | host `repairing` | region entry, after the restage and append commit | resume the region; append is idempotent by `(roundId, id)` |
| `reroute-moved` | reroute transaction (decision 5) | complete the tree sync, then admit the destination |
     | host `built` | loop region exit, before requesting the exit restack | preflight runs the routed exit restack itself (decision 13) |
| host `done` (no commits, or leaf) | no-commit exit or leaf region exit (decision 13) | follow the return cursor |
     | host `restacked` | the restack's `applied` transaction | admit the next child host, else the queue, else the leaf host, else the leaf gates |
     | `closed` (round) | when the last host is `restacked`, `done` or `rerouted`; if no other round is open and the queue is empty, the leaf switch is recorded in this round first (decision 4), otherwise it closes before the queue is consumed | none |

   > **Amended 2026-10-24 by #3203:** The record gains a third kind, `operator`, with an `operator` section written at `prepared`, and the host states `abandoning` and `abandoned`; a closed round counts `abandoned` as terminal. Every kind test is an exhaustive switch. No new ref is created: abandoned work is pinned under the existing `rejected/<roundId>/<k>` (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decisions 1 and 13).

7. **Admission is marker-first, and reconciliation runs after journal recovery.**
   - **Order:**
     - the route record is created in phase `prepared`;
     - one `update-ref --stdin` transaction creates the blob ref
       `refs/conductor/<slug>/repairing` `{host, roundId}` and marks the host `admitted`;
     - outbox events are drained;
     - the leaf is navigated back to `build`, the host region sentinel (decision 8).
   - **Reconciliation** runs inside the stack preflight and conductor resume, after both journal
     recoveries and before `resolveActiveChild`. It follows the table in decision 6. It only
     re-navigates; the append happens solely at region entry, on the checked-out host.
   - **The marker and the automatic restack.** While a marker exists, the preflight never runs the
     automatic `feature-repair` restack for any closed child. Unstamped operator commits on other
     closed children wait to become co-origins of the exit restack (decision 13). While a host is
     `built`, the preflight runs the routed exit restack instead of the automatic one.
   - **Base refresh is deferred.** While any route record is not `closed`, or the re-validation
     queue is non-empty, a base refresh requested by FINISH or a daemon re-kick moves no ref. It
     emits `restack_refused` with reason `deferred-base-refresh`, and runs at the first preflight
     after the last round is `closed` and the queue is empty. The marker alone is not the test,
     because it is deleted between hosts.
   - **One rewind per round.** A round produces exactly one `kickback` event and one leaf
     `navigateBack`. Each host's region entry is not a rewind.
   - **Kickbacks before the region.** A consolidated work order whose earliest target is at or
     before `coverage_binding` is not routed. It keeps today's behaviour.
   - **The no-op guard.** In a stacked round, the route-into-no-op guard
     (`adr-2026-07-13-kickback-build-no-op-escalation` decision 1) runs at the host's region entry,
     after the frozen blocks are written. It never runs at the leaf's route resolution.

   > **Amended 2026-10-24 by #3203:** An operator round is admitted by the CLI under the feature dispatch lease, through `openOperatorRound`, not by the gate loop. Reconciliation's navigate result carries the round's `entryStep`. An undeclared `land` round halts `operator-round-undeclared` before the base-refresh deferral and the navigate arms. With routing eligible, a `repair-pending` cursor with no marker no longer runs the automatic `feature-repair` restack; it halts `unlanded-closed-child-commits` (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decisions 2, 5, 8, 9 and 10).

8. **The cursor gains fields, not kinds, and one execution-child resolver serves every consumer.**
   - **Cursor.** After the `no-child` return, `resolveActiveChild` reads the marker and the queue.
     It reports the existing kinds with added fields:
     - `routedRepair: {child, roundId}`;
     - `revalidating: {child, generation}`.

     The restack planner and executor keep the leaf as the active range.
   - **`repair-pending`.** It is accepted when `repairChildren` contains `routedRepair.child`, plus
     only closed children with unstamped operator commits. Those become co-origins of the exit
     restack (decision 13). Any other set halts needs-human, naming the children.
   - **Execution child.** A single resolver returns the first that exists:
     - the routed host;
     - the re-validating child;
     - the cursor child.

     These use it:
     - region entry;
     - `activateChildRegionState` and its resume variant;
     - the conduct-state mutation port's region writes;
     - `task-cli`;
     - `kickback-budget-cli`;
     - `rewind`'s default `--child`;
     - `daemon-rekick`'s resume authorisation;
     - dispatch identity and events;
     - `daemon status` and the dashboard.
   - **Leaf parking.** After admission, the loop sits on `build`, the host region sentinel. Region
     entry enters the execution child's region instead of the leaf's. The leaf's whole-feature
     gates are restaged stale and are not re-pended until the queue drains (decision 15).

   > **Amended 2026-10-24 by #3203:** A closed non-host child with unstamped post-closure commits is a co-origin only when the open operator round carried it. Any other co-origin halts `unlanded-closed-child-commits`, in every round kind. An explicit closed `rewind --child` opens an operator round (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decisions 8 and 11).

9. **Routed tasks are appended on the host's checked-out branch, carry their child in committed
   text, and merge deterministically on replay.**
   - **Region entry.** Once per `(roundId, host)`, idempotently, recorded in the route record:
     - switch the worktree to the host branch, under the existing dirty-tree refusal;
     - restage the host's `acceptance_specs`, `build`, `test_suite` and `build_review`;
     - write each frozen block exactly as allocated. An existing block with the same id is accepted
       only if its canonical body is identical; otherwise the round halts. An allocated id is never
       renamed or skipped by title. The existing appender's title-drift behaviour applies only to
       N=1;
     - seed task status, including the execution projection.

     No off-checkout commit primitive is introduced.
   - **Acceptance in a routed or revalidate pass** runs in verify-green mode against the child's
     existing specs. It is not a self-heal run. RED was proven before closure, so a retained RED
     marker is checked when present, and its absence is not a refusal. A child closed before this
     change has no `red/c<k>` ref, which is not a refusal either. `closeChild` additionally records the RED proof's
     digest under `refs/conductor/<slug>/red/c<k>`, so the proof survives a worktree recreation.
   - Each block renders `**Child:** <k>` and `**Round:** <roundId>`, and its commit carries a
     `Round:` stamp.
     - The committed `Child:` line is the authority for rem-* membership.
     - `appendedRemediationTaskChildren` in `engine-state.json` becomes a cache derived from the
       plan. Membership fails closed only when both the `Child:` line and the cache are absent.
     - Seal rotation counts ids in a route record's frozen allocation as engine-recorded appends,
       alongside today's recorded ids. That covers replayed blocks and recreated worktrees.
   - The stacked append fails closed: a refused commit halts. The N=1 append keeps today's
     behaviour.
   - **One appender.** Writing the frozen blocks is part of the existing remediation-append seam,
     not a second appender (`adr-2026-08-25-as-built-remediable-findings-bounded-build-route`
     decision 5). It writes only ids in the route record's frozen allocation, which `planRemediation`
     produced at admission, and refuses any other id. Its commit goes through the guarded engine-commit
     helper (`commitEngineChangeWhenStacked`), so the restack ADR's commit fence (decision 4) applies.
   - **Replay merge.** It is a named pre-resolver step in the restack replay.
     - When both sides of a `.docs/plans/<slug>.md` conflict only append whole rem-* blocks, the
       result is the union of blocks, keyed by id, in id order after the authored body.
     - The same id with different bodies halts.
     - Any other plan conflict goes to the existing resolver.
     - Inherited rem-* blocks are excluded from the replayed child's own contribution when its path
       ownership is checked.

10. **One round receipt, settled in the route record, charged once per budget.**
    - **Contents.** The receipt carries:
      - each gate's lap charge;
      - the declared growth, which is the frozen allocation's new-task count;
      - the taskless charges under their gate keys (`manual_test`, or the custom step's id), under
        the existing `MAX_KICKBACKS_PER_GATE` limit. They are charged and cap-checked at admission,
        before the route record is created, in today's order (counter bump, `kickback` event, cap
        check), with today's halt reason, and recorded in the receipt of the record created after a
        passing check;

        > **Amended 2026-10-15 by #3211:** Only `manual_test` is charged in the receipt. A routed post-region custom-step kickback keeps today's durable, tree-keyed ledger bump under the re-opened gate (`adr-2026-07-26-cross-dispatch-kickback-livelock-bound` decision 1), run before the route record is created, with today's `kickback ping-pong` halt reason. The receipt records that charge under the custom step's id as an echo only, and never charges it again.

      - per-host acknowledgements and a settlement id.
    - **Cap check.** Under the existing budget mutation lock, settlement first reconciles receipts,
      then validates every effective lap and growth cap. On exhaustion the receipt stays unsettled,
      the allocation stays pending, and the feature halts with today's cap halt class.
    - **Commit point.** At the first host's BUILD dispatch, before the provider is dispatched, the
      route record's settlement compare-and-swap is the commit point. It charges every gate lap and
      the declared growth once. Later hosts and reroutes only acknowledge. Settlement at the
      dispatch of any child other than the current host is refused.
    - **The ledger is written after the commit point.** It is reconciled by receipt id on resume, so
      a crash on either side neither double-charges nor refunds. These stay ledger-authoritative and
      are never rebuilt from the record:
      - `effectiveLapCap` and `effectiveGrowthCap`;
      - operator budget adjustments and resume authorisations;
      - convergence-credit receipts.

      Gate lap and growth caps for whole-feature gates (`prd_audit`, `architecture_review_as_built`,
      `manual_test`, custom steps), and their raises, live in the flat feature ledger.
      `kickback-budget raise|reset` for those gates ignores the execution-child default. A worktree
      recreation loses these ledger-only adjustments exactly as it does today; this ADR does not
      change that.
    - **Malformed records.** A malformed route record or receipt counts as an exhausted budget, as
      the ledger does (`adr-2026-08-31-kickback-ledger-read-fails-closed`).
    - **Taskless counters** are rebuilt from the receipts on resume, so they survive process
      restarts.
    - **Growth denominator.** For a stacked feature, `authored` is taken from the sealed plan on first
      record, stored, and never re-derived. A stored `0` against a sealed plan with authored task
      headings fails closed. The pending-task exclusion reads the frozen allocation, not the active
      plan.
    - **As-built prior findings.** For a stacked feature, the as-built review's prior-findings input
      reads the route records as well as the ledger, so pending findings survive a worktree
      recreation.
    - **Cap halt with hosts still pending.** The record keeps their allocation pending. A
      `kickback-budget raise` resumes on the same tasks.
    - Each restack still charges one cascade on its originating child (restack ADR decision 10),
      which is a separate budget.

    > **Amended 2026-10-24 by #3203:** An `operator` round charges no gate lap, no growth and no taskless charge. Its empty receipt is acknowledged without settlement, as a `revalidate` receipt is (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decision 12).

11. **Repair obligations carry their branch and are keyed by the round.**
    - **Admission key:** `(roundId, findingId, taskIds)`. It no longer includes HEAD or plan path.
    - **Boundary:** `{branch, head}`, taken at host region entry together with the tree-hash
      baseline that as-built decision 9 uses as no-op evidence.
    - **Order.** For an `existing-task` item, the restage happens at host region entry before the
      BUILD dispatch, failing closed. It no longer happens before the leaf's rewind.
    - **Resolution** reads `Task:` trailers in `head..tip(branch)`. Rewrite translation and the
      per-row trailer restore apply to the host branch.
    - **Reroute.** A verified reroute re-targets the open obligation's branch and boundary in the
      same transaction that records the fallback (decision 5). It mints no second obligation.
    - **Return path.** A completed routed repair returns to its governing gate only after the host's
      region, the exit restack and the queue have finished.
    - N=1 obligations omit `branch`. An absent branch means the checked-out branch, as today.

12. **The host's `build_review` grades the repair against a snapshot base, under a distinct
    routed-repair allowance.**
    - **Routed repair.** The base is the host's closure at region entry, pinned in the route record
      (`baseKind: routed-repair`). Only the repair diff is graded, never the child's
      already-reviewed work.
    - **Re-validation.** The child's replayed contribution is graded against its new parent, with
      the old and new replay tuple retained from the restack journal. A fix made during
      re-validation is then graded against a separately pinned pre-fix base.
    - testQuality materialisation and evidence binding use the same base.
    - Each round grants the host one `routedRepairCredit {roundId}` in its child ledger, emitted on
      the spine. It is a separate allowance, not a convergence credit. The refund rules of
      `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` and restack decision 10
      are unchanged: a `feature-repair` restack still never refunds.
    - The host's other per-child caps are unchanged.

    > **Amended 2026-10-23 by #3212:** The re-validation base is not read from the restack journal.
    > The journal is deleted as soon as `applied` commits (`cleanAppliedJournal`), so it no longer
    > exists when a `revalidate` round runs. Instead, the restack's `applied` transaction copies each
    > queued child's old and new replay parent into its queue entry, and the `revalidation` base
    > reads them from there. The pre-fix base for a fix made during re-validation is pinned in the
    > route record's existing host `entry`.

    > **Amended 2026-10-24 by #3203:** In an `operator` round the host's `build_review` grades `pinnedBase..HEAD` with the round's reason as an operator work-order input beside `repairContext`, and the one per-round credit applies (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decision 9).

13. **Routed exit is a feature-repair restack originating exactly at the host.**
    - When the host region passes, the loop does not call `closeChild` or advance the cursor.
      Instead it:
      - compare-and-swaps the host to `built`;
      - requests a `feature-repair` restack originating at the host. This is the third producer
        named by restack decision 9, under its per-child cascade cap.
    - **No commits.** If the host branch tip equals its closure at region exit, no restack is
      requested. Only two cases can reach this: a revalidate PASS, and an `existing-task` repair that
      appended no block and committed nothing. An audit round that appended rem blocks always has a
      commit, so even when its build ends as a no-op under as-built decision 9, it exits through the
      restack. Tree equality is no-op evidence only; tip equality alone permits this exit. One
      compare-and-swap marks the host `done` (a revalidate entry acknowledged) and deletes the
      marker.
    - **Origins.** The restack halts needs-human unless `plan.originating` is the host plus,
      optionally, closed children whose post-closure commits carry no `Round:` stamp (operator
      commits made during the round). Those children are co-origins. Each is charged its own cascade
      and queued under decision 14. With the host already `restacked`, a re-request is a no-op.
    - **The journal carries the routed refs:** the route record's old and new values, the marker's
      old value, and the queue's old value. Three writes happen only in the `applied` transaction:
      - the marker is deleted;
      - the host is marked `restacked`;
      - the new queue generation is written.

      They are written there by both the normal path and recovery's `synced`→`applied` path. Every
      other terminal state, including rollback, leaves the marker and record untouched. A rollback
      halts as restack decision 5 already requires, so a host left `built` is never re-restacked in
      a loop: the preflight re-runs the exit only after that halt is cleared.
    - The cursor then follows the record, in this order:
      - the next child host in the round;
      - else the re-validation queue;
      - else the leaf host's items;
      - else the leaf gates.
    - A host's exit also acknowledges that host's own queue entry, if one exists, because its region
      has just re-run.

    > **Amended 2026-10-23 by #3212:** A third case reaches the no-commit exit: a host carrying only
    > a taskless obligation (a `manual_test` FAIL or a post-region custom-step kickback, decision 1)
    > whose build commits nothing. Its tip still equals its closure, so it takes the no-commit exit.
    > The leaf HEAD then does not move, the leaf's next `manual_test` PASS is refused by the
    > anti-whitewash check, and `adr-2026-07-13-kickback-build-no-op-escalation` decision 2
    > escalates it. A host's exit that acknowledges its own queue entry records `child_revalidated`
    > for that host, with outcome `fixed` on the restack exit and `passed` on the no-commit exit.

    > **Amended 2026-10-24 by #3203:** Unstamped operator commits on other closed children are no longer automatic co-origins: the exit halts `unlanded-closed-child-commits` unless the open operator round carried them. Carried children originate the exit restack with the host. A closed-child rewind whose host tip still equals its closure is a further case that reaches the no-commit exit (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decisions 8 and 11).

14. **A durable re-validation queue re-judges every closed child a restack moved.**
    - **Production.** Every restack carries, in its journal, the closed-child invalidation set
      computed at its transition. Its `applied` transaction writes the next generation of
      `refs/conductor/<slug>/revalidate`. This covers routed exits, operator commits on closed
      children, base refresh and recovery.
      - A missing or unreadable closed-child verdict counts as invalidated.
      - A child is skipped only when every gate it requires still has a valid input identity under
        the existing gate-invalidation rules. Replay identity and empty `parentOverlapPaths` alone
        never preserve `test_suite`, because a lower child's change can break an upper child without
        touching its files.
    - **Merge.** A new generation dedups by child, keeps the newest closure SHA and orders entries
      by position.
    - **Consumption.** The lowest queued child j becomes a route round of kind `revalidate`:
      - it has no gate lap and no growth charge;
      - its marker `{host: j}` is set before any mutation;
      - its region is restaged once per generation.

      Only the invalidated gates re-run: acceptance against the retained RED proof, `test_suite`,
      and `build_review` under decision 12.
    - **Acknowledgement.** A PASS with no new commits takes decision 13's no-commit exit, which
      acknowledges the entry by compare-and-swap on the generation, the closure SHA and the input
      identity, closes the round and deletes the marker in one transaction. A changed entry stays
      queued. A PASS after a fix exits through decision 13's restack, then is acknowledged.
    - **Failure.** A failing gate is a kickback inside j's region, under j's caps and its own
      routed-repair credit. A fix leaves through decision 13, originating at j.
    - **Cost.** Most routed fixes re-validate every closed child above them. Inherited rem-* plan
      blocks are not themselves an input change. That is the accepted price of a per-child green
      guarantee.
    - **Bound:**
      - restacks are bounded by `MAX_RESTACK_CASCADES_PER_CHILD` per originating child;
      - validation failures without a restack are bounded by each child's region caps;
      - dedup keeps one entry per child per generation.

      Re-validation of N children therefore terminates.

    > **Amended 2026-10-23 by #3212:**
    > - **Eligibility.** Queue production and consumption run only when `routingEligible` holds. With
    >   routing off, no restack reads or writes the queue ref.
    > - **Entry and merge.** An entry is `{child, position, closureSha, gates, replay: {oldParent,
    >   newParent}}`. A merge keeps the newest closure SHA and replay tuple and unions the gates.
    > - **Acknowledgement.** The compare-and-swap is on the generation and the closure SHA. Gate
    >   freshness is checked separately, through each gate's existing fingerprint, not through one
    >   stored input identity. The skip rule uses `classifyReplayGateInvalidation` plus fresh
    >   verdicts, and replay proof normalises inherited rem-* blocks.
    > - **Last entry.** When an acknowledgement empties the queue and no other round is open, it
    >   removes the entry and deletes the marker but leaves the `revalidate` round open.
    >   `returnToLeaf` records the switch in that round, then closes it (decisions 4 and 6).

    > **Amended 2026-10-24 by #3203:** With routing eligible, operator commits on closed children reach the queue only as children an operator round carried; uncarried ones halt `unlanded-closed-child-commits` instead (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decision 8).

15. **The leaf gates re-run when the queue drains, under their existing caps.**
    - When no marker and no queue entry remain, the leaf's whole-feature gates are re-pended under
      their existing lap caps.
    - A routed fix that touched `.docs/specs/**` has already voided the leaf PASS, as prd-audit
      decision 2 requires.
    - The restack's whole-stack tuple (restack decision 8) still invalidates any leaf gate whose
      inputs intersect the delta.
    - The `manual_test` anti-whitewash check is satisfied by the leaf tip moving through the
      restack, which carries the host's fix commits.

    > **Amended 2026-10-24 by #3203:** An abandoned operator round returns to the leaf in an `abandon` mode, which records the switch and closes the round without re-pending the leaf gates, because no restack ran (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decision 13).

16. **Events ride the existing spine through a transactional outbox.**
    - **New `ConductorEvent` members,** all carrying `child`:
      - `remediation_routed {roundId, kind, items: [{findingId, owner, host, reason}]}`;
      - `remediation_rerouted {roundId, from, to, evidence}`;
      - `routed_repair_phase {roundId, host, phase, credit}`, where `credit` marks the
        `routedRepairCredit` grant at `repairing`;
      - `child_revalidated {child, generation, closureSha, outcome}`.
    - **Outbox.** It stores complete `ConductorEvent` values, each with a stable `eventId` and its
      occurrence time. Each is written in the same transaction as the state it reports.
      - Draining persists an event, then removes it from the outbox by compare-and-swap.
      - Queue transitions use an outbox on the queue ref.
    - **Delivery** is at least once. Canonical persister dedup is extended to these four types by
      `eventId`.
    - The refs are durable snapshots, never a second telemetry channel. Every consumer reads the
      spine.

17. **N=1 parity is structural and proven by the golden suite.**
    - With `no-child`, none of these is read or written:
      - the router and the routing call;
      - the marker and the queue;
      - the receipt and the outbox.

      The append, settlement, obligation and hook paths run today's code.
    - The #3019 N=1 golden suite gains a guard. A `PATH`-shimmed `git` records argv, and the suite
      asserts that no `refs/conductor/<slug>/routes`, `repairing` or `revalidate` ref is touched
      when the cursor reports `no-child`.

18. **Routing ships dark behind a default-off flag, and delivery is split across four specs.**
    - A boolean project setting, `stacked_prs.route_whole_feature_fixes`, defaults to `false`. The
      router is entered only when the cursor reports durable children **and** the setting is
      `true`. With it off, a stacked feature remediates exactly as before this ADR, and no routing
      ref is read or written by the router.
    - Delivery is split by operator decision (2026-10-12), because one 99-task build was not
      buildable:
      - #2944 delivers the foundation: decision 6's types, refs, teardown, store and journal fence;
        decision 8's cursor fields and execution-child resolver with every consumer; decision 16's
        event members, persister dedup and outbox drain on resume; decision 17's N=1 golden guard;
        and this decision's flag.
      - #3210 delivers decisions 1–4 and 7, and the route-record writers of decisions 6 and 16.
      - #3211 delivers decisions 5 and 9–12.
      - #3212 delivers decisions 13–15 and the queue outbox of decision 16, then changes the
        setting's default to `true`.
    - Each spec is blocked by the one before it, so the flag stays off until the whole design is
      present.

    > **Amended 2026-10-23 by #3212:** #3212 also delivers the items #3210 and #3211 moved to it:
    > - decision 9's rem-block replay merge;
    > - decision 12's re-validation review bases and the per-pass credit;
    > - `selectNextHost` host progression;
    > - `hostNoOpEvidence`;
    > - the restack-writer exemption from decision 6.
    >
    > It wires the routed-exit restack to the refusal in
    > `adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 11. A published stack is
    > frozen, so the follow-up below that names #2945 belongs to #3269 (the PR comment on a published
    > child) and #3268 (refreshing a published stack).

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Story ownership is total because land refuses stories spanning children, so every task-bound finding maps to exactly one child | verified | 97% | yes | Task-bound routing would need judgement too | — |
| A2 | A non-halt commit past a closure with no marker triggers the automatic `feature-repair` restack at the next preflight | verified | 98% | yes | Marker-first ordering would be unnecessary | — |
| A3 | The restack executor throws on cursor kinds other than `active` and `repair-pending` | verified | 95% | yes | A new cursor kind would be acceptable | — |
| A4 | A `manual_test` FAIL kickback creates no task or receipt, and its counter is process-local | verified | 97% | yes | Taskless obligations could share the round receipt unchanged | — |
| A5 | The restack's `applied` transaction can carry additional ref updates (route, marker, queue) alongside the cascade count | verified | 90% | yes | Routed exit would need its own transaction and recovery | — |
| A6 | Resetting a host branch to its closure, with every non-round commit refused first and the rejected tip pinned, loses no work | inferred | 90% | yes | A reroute could drop work | APPROVED by operator 2026-10-12 |
| A7 | Closure-tree path presence of prerequisite inputs is a sound pre-mutation signal for file-level prerequisites; symbol-level ones are left to the verified builder claim | inferred | 85% | yes | Some fixes would be mis-hosted before the build | APPROVED by operator 2026-10-12 |
| A8 | One routed-repair `build_review` credit per round is enough for a repair-sized diff | inferred | 80% | yes | Routed repairs would cap out and halt needs-human more often | APPROVED by operator 2026-10-12 |
| A9 | A deterministic union merge of appended rem blocks covers the plan conflicts routed repairs produce; other plan conflicts are rare and go to the resolver | inferred | 85% | yes | Restacks after routed repairs would halt on plan conflicts | APPROVED by operator 2026-10-12 |
| A10 | Freezing every host's rem allocation at admission, and charging declared growth at the first host, is an acceptable reading of "settles exactly once at the target child's dispatch" | inferred | 85% | yes | Growth would need charging per host, adding a lap-split rule | APPROVED by operator 2026-10-12 |

> **Amended 2026-10-24 by #3203:** Assumption A2 now holds only with routing off. With routing eligible, a non-halt commit past a closure with no marker halts `unlanded-closed-child-commits` at the next preflight (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decision 8).

## Consequences

### Positive
- Each child PR receives the fixes that correct it, so stacked review works.
- Routing costs nothing for task-bound findings and nothing at N=1.
- Every routing step survives a crash and a worktree recreation, and is visible on the spine.
- Closed children are re-judged after any restack, closing the gap #2943 left open.

### Negative
- Three new ref-backed records, two cursor fields, an execution-child resolver and a new restack
  producer add state that the operator runbook must explain.
- A round touching several children takes several region passes and restacks, run one after
  another.
- Settlement for stacked features moves from "any build dispatch" to "the first host's dispatch".
- The shared plan file makes some re-validation unavoidable after every routed fix.

### Follow-up Actions
- [ ] #3210, #3211, #3212: the remaining routed-repair decisions, in that order (decision 18).
- [ ] #3203: manual landing aid and closed-child rewind, built on this route record. The
      closed-child rewind refusal now names #3203.
- [ ] #2945: post a PR comment on a published child that received a routed fix, and refresh a
      published stack.
- [ ] #2947: per-child custom steps route their own kickbacks inside the region.
- [ ] Runbook: routed repair, re-validation and cascade-cap exhaustion with the marker set, in
      `docs/runbooks/stalled-or-stuck-feature.md`.

## Amendments made by this decision

- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`: D3, D4, D5, D6.
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route`: D3, D4, D5, D7, D8, D9.
- `adr-2026-09-06-reopened-task-resolution`: D1, D2, D6, D8, D9, D12.
- `adr-2026-08-22-one-owner-per-review-question`: D1.
- `adr-2026-07-13-kickback-build-no-op-escalation`: D1, D2.
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery`: D1, D5, D6.
- `adr-2026-07-06-manual-test-fail-routing`: decisions 2, 3.
- `adr-2026-07-10-validation-group-join`: decision 3.
- `adr-2026-08-12-cumulative-build-review-convergence-bound`: D1.
- `adr-2026-10-03-stacked-child-plans-identity-and-state`: decisions 8, 10, 11, 13.
- `adr-2026-10-07-per-child-build-region`: decisions 1, 4, 5, 6, 8, 9, 10, 11.
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance`: decisions 2, 4.
- `adr-2026-10-10-stacked-restack-journaled-replay`: decisions 3, 4, 6, 7, 8, 9, 10, 11.
- `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`: decision 3.
