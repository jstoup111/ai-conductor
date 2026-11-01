# ADR: A stacked feature publishes as a GitHub native stack whose leaf alone ships the feature

**Date:** 2026-10-17
**Status:** APPROVED
**Deciders:** operator (James Stoup), with adversarial review by Codex (gpt read-only) and Claude (Opus)

## Context

#2945 is the publication ticket of the stacked child-plans chain (chain design in #2940). The
diagrams are in `.docs/architecture/stacked-features-cannot-be-published-reviewed-and-.md`. It
builds on five shipped tickets:
- `adr-2026-10-03-stacked-child-plans-identity-and-state`: branch grammar, per-child state, the
  optional event `child`;
- `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`: slices and story ownership;
- `adr-2026-10-07-per-child-build-region`: the per-child BUILD region, closures and positions;
- `adr-2026-10-10-stacked-restack-journaled-replay`: the journaled restack and pushed-tip records;
- `adr-2026-10-12-routed-whole-feature-repair`: routed repair, which runs before publication.

By operator decision (2026-10-17) this ADR covers the ship-path slice of #2945. The operator
expects to merge a stack as one unit. Four follow-ups are filed separately:
- #3267: dedicated `bundled` and `Stack-Child:` release and shipment contracts;
- #3268: `stack adopt`, refresh of a published stack, and verified acceptance of the server-side
  rebase after a partial merge;
- #3269: a PR comment on a published child that received a routed fix;
- #3270: surfacing red CI on an intermediate member.

**Verified facts at the spec base** (`757ae99776`; engine paths under `src/conductor/src/engine/`):
- **A stacked feature ships today as one bundled PR.**
  - The FINISH `rebase` step restacks every child locally (`conductor.ts`, `runRestack`). FINISH
    then publishes only `state.worktree_branch`, the leaf (`finish-publication-production.ts`,
    `establishPr`).
  - `PublicationPullRequest` models exactly one PR. The seven publication transitions are
    `establish_pr` → `verify_release_readiness` → `author_pr_prose` → `judge_pr_prose` →
    `write_shipped_record` → `ready_pr` → `record_outcome` (`finish-publication.ts`,
    `nextFinishPublicationTransition`).
  - `FINISH_PUBLICATION_PROGRESS_ALLOWANCE` is 2 × 7, and a test pins it.
  - A transition whose owned dimension does not move after a successful effect is
    `human_required: publication_transition_unmoved` (`advancedPublicationTransition`).
- **Prose is one feature-level FINISH dispatch.** Authoring and judging re-run the `finish` step
  with `finishProsePass` (`conductor.ts`) and ignore the request's PR URL. The provider CLI may
  edit only the PR of the checked-out branch (`github-operations-cli.ts`). A successfully authored
  placeholder is accepted without a separate judgement (`finish-publication-production.ts`).
- **The presentation repair is leaf-specific.** `repairPresentation` runs halt rehabilitation (which
  injects `Closes <sourceRef>`), the title and body floors, the accepted-risk projection, the
  `Plan:` declaration projection, region restore, and then `ensureShipReady`
  (`finish-presentation-repair.ts`, `halt-pr-rehabilitation.ts`).
- **Child branches never leave the machine.**
  - `feat/c<k>/<slug>` branches are local-only (build-region ADR decision 11).
  - `executeRemoteGit` is the one choke point for engine pushes. It records a pushed tip and a push
    intent under `refs/conductor/<slug>/pushed/<branch>` and `…/push-intent/<branch>` for every
    daemon-owned ref, children included (`remote-git-operations.ts`, `push-lease.ts`).
  - `forcePushWithExpectedLease` pushes only `HEAD`. It fails when the remote branch does not exist
    yet, because it fetches the destination first. It adopts an outstanding push intent whose `new`
    SHA equals the remote.
- **Child positions are sealed and need not be contiguous.** A child's parent is the previous
  declared position (`child-lifecycle.ts`). `validatePlanSlices` rejects only duplicate and empty
  slices (`plan-slices.ts`). Durable children stay authoritative even if `stacked_prs.enabled` is
  turned off later (build-region ADR decision 2).
- **Several lookups assume the leaf's base is the default branch.**
  - `resolveRetainedShipDraftPrUrl` (`--head <leaf> --base <default> --state open`) is read on
    every self-host FINISH dispatch by `readShipDraftReleaseMetadata`, and by region prepare and
    capture.
  - `clearRetainedHaltStateForDispatch` falls back to the same query.
  - `shipped-readiness.ts` grants `no-checks` only for base `main`.
  - `openShipDraftPr` re-observes by head only.
- **Other engine pushes to the leaf after FINISH:**
  - the shipped-record primitive;
  - `refreshPostFinishShippedRecord` (`post-finish-shipped-record.ts`);
  - `escalateBuildFailure` (`build-failure-escalation.ts`);
  - agent pushes through `conduct github-operation` (`github-operations-cli.ts`);
  - sweep ci-fix (`ci-fix.ts`, through `pushRefreshedBranch` in `autoresolve.ts`).

  Autoresolve already escalates `published-stack` for durable child state. Nothing in the restack
  refuses on that reason (`restack/restack-types.ts`).
- **The guarded GitHub registry is closed** (`github-operations.ts`).
  - `pull-request.edit` accepts only a title and a body.
  - There is no stack operation and no stack resource kind.
  - `pull-request.create` is the only write exempt from exact-target provenance matching
    (`owner-gate/mutation-policy.ts`). Authorization does not see payloads.
- **Teardown.**
  - The sweep watches one PR per slug. Teardown is gated only on `.docs/shipped/<slug>.md` being
    present on `origin/main`.
  - Teardown removes the worktree and the explicit-name conductor refs. It never deletes a local
    branch, the leaf included (`daemon-deps.ts`). The cleanup list omits `positions`
    (`restack/restack-refs-cleanup.ts`).
  - A failed reap drops the watch entry (`mergeable-sweep.ts`). `reclaim-worktree` removes only the
    worktree (`daemon-park-cli.ts`).
  - The repository sets `delete_branch_on_merge: true` and squash-only merges.
- **Release metadata and shipment are per PR.**
  - The required `release-metadata` check validates only the shape of the body. Its workflow skips
    drafts and has no branch filter.
  - `shipped-record.yml` has neither a branch filter nor a draft skip.
  - The premerge check classifies by exact `Plan:` declaration, and zero matches are
    not-applicable.
  - Post-merge reconcile and the audit match **any** `.docs/plans/<stem>.md` string in a body
    (`extractPlanStems` in `shipment-evidence-cli.ts` and `shipment-audit.ts`). No shipment adapter
    reads the head ref. A merged child whose body mentions the plan path would be reconciled as the
    feature's implementation PR, which is a false-ship path.
- **CI runs only for PRs based on `main`.** `ci.yml` uses `on: pull_request: branches: [main]`
  with the default activity types. Its docs-only detection diffs `base.sha..head.sha`.
- **Halt classes.**
  - An unknown class is retained by the re-kick sweep (`daemon-rekick.ts`).
  - A class reaches a committed record only through `isRecordableHaltClass` (`halt-record.ts`).
  - Halt records on a child branch are never pushed.
- **Events.** `EventPersister` de-duplicates by `eventId` only for its listed observation and routing
  types (`event-persister.ts`). The sweep emits through its injected `onEvent`.

**Verified GitHub facts** (docs.github.com, read 2026-10-17):
- Stacked PRs became generally available on 2026-10-06.
- REST (`/rest/pulls/stacks`):
  - `GET/POST /repos/{o}/{r}/stacks`, `GET …/stacks/{n}`, `POST …/stacks/{n}/add` and
    `POST …/stacks/{n}/unstack` exist.
  - Create takes `pull_requests` ordered bottom to top, and "Each pull request's base ref must match
    the previous pull request's head ref."
- "GitHub Actions workflows trigger as if each pull request in the stack targets the base of the
  stack." Members carry `github.event.pull_request.stack`.
- Branch protections apply to every member. Merges go bottom up. After a bottom merge, the remaining
  branches are rebased server-side and retargeted to the stack base.
- Draft PRs can be stack members: stack #2265 was created at 13:19:44Z, and member #2263 became
  ready at 13:20:09Z (`gh api …/issues/2263/timeline`).

## Options Considered

### Option A: Publication with dedicated stack contracts (the filer's hypothesis)
Children declare `Release-Disposition: bundled` with a reference to the leaf, plus a `Stack-Child:`
marker that the validator, renderer, candidates and shipment association learn.
- **Pros:** the release audit ties every child to its leaf explicitly.
- **Cons:** it changes a required check and the release pipeline. **Deferred to #3267 by the
  operator.**

### Option B: Publication reusing existing contracts (chosen)
Children carry the template's default regions, which here means `no-note`, plus no plan
declaration and no closing reference. The leaf alone carries the feature's note, `Plan:`,
`Closes`, the migration block and the shipped record. A head-ref guard keeps children out of
shipment association.
- **Pros:** release and migration semantics do not change, and the note appears once.
- **Cons:** children read as ordinary `no-note` PRs in the release audit until #3267.

### Option C: Open every member at SHIP entry
Every member would be reviewable before the whole-feature gates pass, and any SHIP-gate fix would
push to already-published children. That is the refresh path #3268 owns. Rejected.

### Child bodies: engine-rendered (chosen) or LLM-authored
LLM-authored child bodies would need a new structured authoring call carrying child context, plus
engine-applied writes to each child PR. The current dispatch provides neither. That means N× the
provider cost and a riskier N=1 surface. The operator chose deterministic, engine-rendered child
bodies. The leaf keeps today's authored prose.

### Leaf creation order and ready order
The leaf opens first, as today, because project-owned regions need the retained draft before
their SHIP-phase owners run (`adr-2026-09-24-project-owned-pr-body-regions` decision 4). It is
retargeted once at FINISH.

Members flip ready top-down. A stack merges only bottom up, so nothing is mergeable until member 1,
the last flip, is ready. Bottom-up flipping would allow a merge between flips. That is practically
unreachable, because a merge needs an approval and green checks first, but top-down costs nothing.

## Decision

Option B, with engine-rendered child bodies and the leaf draft opened at SHIP entry as today.

1. **Durable child state, not the flag, decides stack publication; every other feature is
   byte-identical to today.**
   - A feature is stacked at FINISH when its sealed positions ref (`refs/conductor/<slug>/positions`)
     declares at least two positions, whatever `stacked_prs.enabled` says now
     (build-region decision 2). The flag keeps gating only whether children are created.
   - **Non-stacked features.** The stack observer returns `not-applicable` from local refs alone,
     before any GitHub read. Neither new transition is selected and no stack event is emitted.
     The following are byte-identical to today:
     - PR bodies, events and state files;
     - GitHub and git argv;
     - the shipped record and its Cost block;
     - the 2 × 7 allowance.

     The Time block keeps its structure; per umbrella decision 14 its timings are not golden-tested.
   - The N=1 golden suite (umbrella decision 14) is extended to the FINISH transition-event sequence
     and the gh and git argv list.

   > **Amended 2026-10-20 by #2945 (operator decision):** "Byte-identical git argv" covers git
   > commands that reach a remote or mutate refs, the index or the working tree. Local read-only
   > probes of conductor refs under `refs/conductor/<slug>/` are excluded from that parity: for
   > example `rev-parse --verify` of the positions ref or the publication ref, and `for-each-ref`
   > over `refs/conductor/<slug>/`. They are how a non-stacked feature returns `not-applicable`
   > "from local refs alone". The decision 11 guard, and build-region decision 2's durable-child
   > detection, run those probes on every push and resume, whether or not feature-local metadata
   > (child directory, envelope) is present. Absent disposable metadata never counts as proof that
   > there is no stack. The N=1 golden records the probes in a separate list and pins the remote
   > and mutating argv unchanged.
   - **Allowance.** The allowance stays twice the number of publication transitions the feature
     can select (`adr-2026-08-06-bounded-progress-allowance-for-finish-publication` D1). That is 2 × 7
     for a non-stacked feature and 2 × 9 for a stacked one, because each transition processes every
     member in one effect (decision 3).

2. **The child-to-PR map lives in a ref-backed publication record.**
   - **Shape.** `refs/conductor/<slug>/publication` points at a JSON blob:
     `{version: 1, retarget?: {from, to, phase: 'intended' | 'observed'}, stack?, members: [{position,
     branch, pr, lastSeen?}]}`.
     - `members` is ordered by sealed position. The leaf is the last member, with the retained draft's PR number.
     - `retarget.phase` separates an intended base change from one GitHub has confirmed.
   - **Writes.** Every write is a compare-and-swap `update-ref` against the observed old value. The
     record is never pushed, survives worktree recreation (#497), and is deleted only by explicit
     name (decision 12).
   - **GitHub stays the source of truth on resume.** Members are discovered by head ref in every
     state (open, closed, merged), and the record is reconciled to what GitHub reports. After an
     ambiguous create response, the engine re-discovers before it retries. Publication runs only
     inside the feature's FINISH dispatch, and FINISH dispatches are already exclusive per slug.
   - **The record is never trusted as progress.** Every transition is still selected from the
     observed snapshot, and the record only names what to observe, so it is not a progress ledger
     (`adr-2026-08-01-engine-owned-resumable-finish-publication` D1).
   - **Terminal records.** A teardown or reclaim that keeps the record (decisions 9 and 12) marks it
     `tornDown`. The observer, the freeze and the tip guard ignore a torn-down record, and a later
     feature that reuses the slug replaces it.
   - **The leaf's ship records are unchanged.** `conduct-state.json` keeps one `pr_url`, the leaf's.
     `finish-record` keeps its child refusal (umbrella decision 2). Recording a child PR as the ship
     is the false ship `adr-2026-07-07-finish-record-primitive` D3 forbids.

3. **Publication adds two transitions, each processing every member in one effect.**
   - The order becomes:
     - **Step 1.** `establish_pr`
     - **Step 2.** `establish_child_prs` (new)
     - **Step 3.** `verify_release_readiness`
     - **Step 4.** `author_pr_prose`
     - **Step 5.** `judge_pr_prose`
     - **Step 6.** `write_shipped_record`
     - **Step 7.** `assemble_stack` (new)
     - **Step 8.** `ready_pr`
     - **Step 9.** `record_outcome`
   - **Stack dimension.** It is one of `not-applicable`, `members-missing`, `unassembled`, `valid`,
     `diverged` or `indeterminate`.
     - A successful `establish_child_prs` always moves it out of `members-missing`, and a successful
       `assemble_stack` always moves it to `valid`. An effect that fails part-way fails, and the
       next attempt resumes at the first incomplete member.
     - `indeterminate` follows today's indeterminate routing. `diverged` halts (decision 11).
   - **Prose dimensions** stay leaf-only. Children have no prose dimension, because their bodies are
     rendered (decision 6).
   - `FinishPublicationTransition` gains `establish_child_prs` and `assemble_stack`. The existing
     `finish_publication_*` events carry them, and the event-sinks registry rows are updated.

4. **Children are pushed and opened only in `establish_child_prs`, after every leaf gate has
   passed.**
   - Every gate before FINISH has passed by this point, including the self-host VERSION and
     release-artifact gates (`adr-2026-07-29-ship-start-draft-pr` D9). The leaf must still be a
     draft. A leaf that a human made ready is converted back to a draft through the guarded
     `pull-request.draft`, which emits `stack_member_redrafted`.
   - For each sealed child position p, in order, excluding the last position (the leaf):
     - Step 1: **Verify** that the closure `refs/conductor/<slug>/closed/c<p>` exists and that the next
        position's branch contains it. Halt-record-only commits past the closure are tolerated, as
        build-region decision 1 allows. They are never pushed, because only the closure SHA is
        pushed.
     - Step 2: **Push** the closure SHA to `refs/heads/feat/c<p>/<slug>` through `executeRemoteGit`, after
        one `ls-remote` that tells an absent ref apart from a failed read.
        - Absent: a plain push, which creates the branch and can overwrite nothing.
        - Present and equal to both the recorded pushed tip and the closure: no push.
        - Anything else: `diverged`.
        - A failed read is a retryable publication failure.

        No new push form is introduced (`adr-2026-07-03-post-rebase-force-with-lease`,
        `adr-2026-09-23-engine-git-guard-on-agent-path` D14).
     - Step 3: **Find or create** the PR for that head: any state, or a new **draft**. Its base is
        `«default»` for the first position, otherwise the previous position's branch. Its body is
        rendered per decision 6.
     - Step 4: **Record and announce:** CAS-write the member and emit `stack_member_published`.
   - **Divergence.** A recorded member that is closed or merged, or open with a different base or
     head SHA, makes the stack dimension `diverged`. While the record has no `stack`, a member that
     is ready instead of draft is also `diverged`. Once the stack is assembled, ready members are
     `ready_pr` progress (decision 7).
   - **A child branch is pushed only here.** Halt records are still never pushed to a child.

5. **The leaf is retargeted and the stack assembled only in `assemble_stack`, after the shipped
   record is written.**
   - Step 1: **Retarget.** If the leaf PR's base is `«default»`, the engine CAS-writes
      `retarget {from: «default», to: feat/c<last child>/<slug>, phase: intended}` and calls the new
      guarded `pull-request.retarget`. It then CAS-writes `phase: observed` once the PR reports the
      new base.
      - `pull-request.retarget` is its own operation, never a `pull-request.edit` field, so a body
        edit cannot move a base.
   - Step 2: **Assemble.** The engine reads the stack holding member 1 (`stack.read`, by PR number).
      - With no stack, it creates one with every member bottom up (`stack.create`), and CAS-writes
        the returned number as `stack: {number, verified: false}`.
      - With a correctly ordered prefix, it CAS-writes that stack's number the same way, then adds
        the rest (`stack.add`).
      - Any other shape is `diverged`: a member in another stack, a wrong order, or a missing
        middle.
   - Step 3: **Verify.** It re-reads the stack, then confirms that member order equals the record and that
      each member's head SHA equals its recorded pushed tip. Only then does it CAS-write
      `stack.verified: true` and emit `stack_assembled`.
   - **Base-dependent lookups.** Every leaf lookup that assumed the default base accepts exactly
     `retarget.from` or `retarget.to` for this record. That covers the retained-draft resolution,
     the self-host release-metadata read, region prepare and capture, and halt-state clearing. They
     never accept any other base. They issue today's exact query first, and read the record only
     when that finds nothing and `.pipeline/children/` holds a child, so a non-stacked feature issues
     no new git command. Shipped readiness is unchanged: a retargeted leaf with no checks
     is `ci-pending`, exactly as any non-`main` base is today
     (`adr-2026-10-09-shipped-pr-readiness-verdict` decision 2).
   - Leaf success never implies a complete stack. `ready_pr` is unreachable until the stack
     dimension is `valid`.

6. **Child bodies are rendered by the engine. The leaf body keeps today's authored prose.**
   - **Child body.** Rendered deterministically from sealed evidence and committed into no file:
     - title from the slice's manifest name;
     - a summary listing the child's own accepted stories (title and id) and tasks, from the slice
       manifest and the sealed envelope;
     - a diffstat of the child's own diff against its base;
     - the engine-owned `## Stack` section: ordered members, this one marked;
     - every project-owned region at its template default, which is `Release-Disposition: no-note`
       and migration `none` in this repository. No region owner runs for a child, and no capture is
       taken from one.
   - **Leaf body.** The leaf gets the same `## Stack` section. `assemble_stack`'s re-render of it is a
     FINISH body rewrite, so it re-inserts every captured region byte for byte
     (`adr-2026-09-24-project-owned-pr-body-regions` decision 6). The release note, `Plan:`
     declaration, `Closes`, the build-review blocks and the migration block appear only on the leaf.
   - **Engine-authored child postconditions.** These are checked when the body is written and
     again before the ready flip:
     - no `.docs/plans/…md` string, using the pattern reconcile uses;
     - no closing keyword referencing an issue;
     - regions byte-equal to the template default.

     They bind what the engine writes. A human later editing a child body, for example to add a
     closing reference, is a human decision.

7. **Members flip ready top-down, each by a child-only or leaf-only path.**
   - **Order.** `ready_pr` flips the leaf first, then children from the highest position to the
     lowest. No member is mergeable until the lowest is ready.
   - **Resume.** An interrupted `ready_pr` accepts the members already ready and flips the remaining
     drafts in the same order.
   - **Leaf flip.** The leaf runs today's `repairPresentation` unchanged.
   - **Child flip.** A child runs only its postconditions and then `ensureShipReady`, never
     rehabilitation, floors, or `Plan:` or accepted-risk projection.
   - **Before each flip** the engine re-reads stack membership and head SHAs. Any change is
     `diverged`.
   - The snapshot's `pr.ready` is true only when every member is ready.

8. **Required checks pass on every member through existing contracts plus two mechanical changes.**
   - **CI trigger.** `ci.yml`'s `pull_request` filter becomes `branches: [main, 'feat/c*/**']`.
     - Members above the first are opened against a child base before the stack exists, so without
       this they never trigger CI.
     - Results bind to the head SHA. Once a member is stacked, its runs may diff against the stack
       base, which is a superset of its own diff, so detection is never weaker.
   - **Release metadata.** `release-metadata` passes on a child's template-default `no-note` and on
     the leaf's note, at the ready flip.
   - **Head-ref shipment guard.** Shipment association in premerge, reconcile and audit mode
     classifies a PR whose head ref parses as a child branch (`parseFeatureBranch` kind `child`) as
     `not-applicable`, classification `stack-child`, before reading the body.
     - The CLI metadata reader, the event decoder, the audit query and the reconcile adapter each
       gain the head ref.
     - Premerge fails the check when the head ref is unavailable, a narrow exception to the
       always-reporting check (`adr-2026-07-25-fail-closed-durable-shipment-evidence` decision 4).
       The `pull_request` event always carries the head. Reconcile and audit open no repair without
       one.
     - The leaf keeps today's classification.

9. **Only the leaf merging ships the feature, and the ship gate is unchanged.**
   - The sweep still watches one entry, the leaf PR.
   - Teardown is still gated only on `.docs/shipped/<slug>.md` on `origin/main`, and only the leaf's
     diff carries that file. A merged lower prefix records no ship, keeps the intake open (`Closes`
     is only on the leaf) and triggers no teardown. A leaf merged into a child branch after a human
     dissolves the stack fails the same gate.
   - **Reachability.** When the gate passes, each member's diff must be reachable from
     `origin/main`: the member PR is merged, and the commit GitHub records for that merge
     (`merge_commit_sha`, which is the squash commit in this squash-only repository) is an ancestor of
     `origin/main`.
     - An unreachable member is reported in `stack_members_unreachable` with its PR number, then
       marked `unreachableReported` in the record. Its branch and the record are kept, so the
       receipt survives, and the report is never repeated.
     - An indeterminate check keeps the watch entry for the next sweep.
     - Reachability gates only child-branch and ref deletion (decision 12). Worktree removal still
       happens in the same sweep pass, as today. Reachability is never the ship or reap gate.

10. **Non-leaf lifecycle is observed by the sweep and reported on the spine, at least once.**
    - **What the sweep reads.** On each visit to a stacked entry whose leaf is open, the sweep reads
      the stack and each member's state.
    - **Event.** A member newly seen `merged`, `closed` unmerged, or `reverted` emits
      `stack_member_lifecycle` with the child position, PR number, state and a deterministic
      `eventId`. The event is emitted first, then the member's `lastSeen` is CAS-written.
      - Delivery is therefore at-least-once. The persister de-duplicates by `eventId`, so the type
        joins its de-duplicated set.
      - `reverted` means a merged PR on the default branch carrying GitHub's
        `Reverts <owner/repo>#<n>` line for that member. It is sought only for merged members while
        the leaf is open.
    - **No effect on shipping.** These events never change ship, intake or teardown.

11. **A published stack is frozen against engine rewrites. Any write that would move a member
    refuses, and FINISH publication halts on a mismatch.**
    - **Freeze.** Once the record has any member that is not torn down, every restack producer
      refuses with the existing `published-stack` reason and emits `restack_refused`.
      - **Base refreshes.** The FINISH `rebase` step and the re-kick base refresh refuse, then
        continue without moving anything. FINISH proceeds to its next step and re-kick retries its
        gate on the current base. This is a narrow exception to the mandatory play-forward
        (`adr-2026-09-11-finish-mergeability-respects-active-review-inputs` decisions 5 and 6).
      - **Local work.** The stack-preflight `feature-repair` restack and the routed-exit restack refuse
        and halt `needs-human`, naming the child, because local work on a published child cannot
        reach its PR without a refresh.
      - **Routing.** Route admission refuses a new round, naming `published-stack`.
      - **ci-fix.** Sweep ci-fix is ineligible for the leaf PR and escalates as autoresolve does today
        (`adr-2026-07-07-ship-ci-feedback-loop` decision 2,
        `adr-2026-10-09-shipped-pr-readiness-verdict` decision 3).
      - Refreshing a published stack is #3268's.
    - **Guard at the choke point.** `executeRemoteGit` runs a stack tip guard for any destination
      that is a member branch of a slug with a record, and `pull-request.retarget` runs it too.
      - **Step 1.** It first recovers outstanding push intents exactly as `push-lease.ts` does today.
      - **Step 2.** It then reads every member's remote head in one `ls-remote` and compares each with
         `refs/conductor/<slug>/pushed/<branch>`.
      - **Step 3.** On a match, the write may proceed only as a fast-forward of the recorded pushed tip. The
         recorded tip must be an ancestor of the source. A rewrite of a published member is refused
         even when every tip matches. This narrows, for published members only, the rows of restack
         decision 11's lease table that permit a non-fast-forward.
      - **Step 4.** On a mismatch, it refuses.
    - **Caller mapping:**
      - FINISH publication (decisions 4, 5 and 7) writes a HALT of the new class
        `stack-tip-diverged` whenever the stack dimension is `diverged` or the guard refuses, naming
        the mismatched members, and emits `stack_tip_diverged`. `diverged` covers a moved remote tip,
        a closed or merged member, a wrong base and a wrong stack membership or order. The
        class is a third writable class beside `needs-human` and `mechanical`
        (`adr-2026-07-28-total-halt-classification-legacy-boundary` D1). It joins the `HaltClass`
        union, `readHaltClass`, `isRecordableHaltClass`, the operator-action set and
        `RETAINED_HALT_CLASSES`, so the re-kick sweep skips it.
      - Best-effort pushes skip.
        - The halt-record push emits `halt_record_push_failed` with reason `stack-tip-mismatch` and
          keeps the record's "may be ahead of the remote" note
          (`adr-2026-08-23-committed-halt-record` D5).
        - `refreshPostFinishShippedRecord` logs the skip.
      - `escalateBuildFailure` and agent pushes report the refusal.
    - **Reads never halt.** A partial merge the operator completes by merging the rest never halts.
    - **Recovery** is a manual runbook procedure in `docs/runbooks/stalled-or-stuck-feature.md`
      (written by #3273):
      merge the remaining stack in GitHub and clear the halt, or close the stack and park the
      feature. Pushed-tip refs are never re-recorded by hand. `conduct stack adopt` is #3268's.

    > **Amended 2026-11-01 by #3269:** A routed fix and a `stack land` landing now pass the freeze, and FINISH refreshes the moved members with one narrow rewrite arm in the tip guard: every member tip matches its receipt, FINISH passes its refresh authorization, and the refresh ledger's recorded tip is an ancestor of the source. Every other producer stays frozen, and every other write stays fast-forward only (`adr-2026-11-01-routed-fix-refreshes-a-published-stack`).

    > **Amended 2026-10-24 by #3203:** With routing eligible, the preflight checks publication before `unlanded-closed-child-commits`, so a published stack with post-closure commits keeps this `published-stack` halt and is never told to run `stack land`. `stack land` and the closed-child `rewind` refuse on a published stack, naming #3268 (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decisions 4 and 8).

12. **Teardown removes a stacked feature's child branches only after the leaf merges, by explicit
    name, in a fixed order.**
    - When the existing reap gate passes, the sweep:
      - **Step 1.** reads the positions ref and the record;
      - **Step 2.** removes the worktree, as today;
      - **Step 3.** runs decision 9's reachability check;
      - **Step 4.** deletes each local `feat/c<p>/<slug>` for the sealed child positions under the stack-member
         proof, a third deletion authority
         (`adr-2026-08-01-multi-proof-park-deletion-authority` decisions 1 and 2):
         - the member PR is merged;
         - its squash commit is an ancestor of `origin/main`;
         - the local branch tip equals that PR's `headRefOid`.

         The delete is a compare-and-swap with that tip as the expected value. A member failing
         the proof is kept.

         > **Amended 2026-10-31 by spec `a-partial-stack-merge-or-mid-stack-push-halts-the-` (operator decision, composer DECIDE):** The third condition is now an accounted-for proof. Every commit reachable from the local tip, and not from the recorded `pushed/<branch>` tip or the merged PR's `headRefOid`, must be a halt-record-only commit for this slug (`isHaltRecordOnlyCommit`). A head that GitHub moved after publication no longer keeps the member: a merge of `main`, a pushed CI fix, or the server-side rebase after a partial merge. When the head object is missing locally it is fetched by SHA. A failed fetch or probe is `failed` and retries; it never becomes `kept`. The delete is a compare-and-swap on the local tip that the proof read. A commit that the engine pushed and a reviewer later dropped no longer keeps the branch, because the merged PR is the authority. Branches already kept behind a `tornDown` record are not revisited. All 3 stacks published before this change kept every child this way.
      - **Step 5.** deletes the conductor refs. Once every child is deleted, this path alone deletes `positions` and `publication` by explicit name. They stay out of the shared cleanup list that park reconciliation uses, so park can never orphan a kept child branch.
         While any member is kept, the record is kept and marked `tornDown` instead.
    - A failure at any step stops the remaining steps and keeps the watch entry
      (`adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` decision 7).
    - Remote child branches follow the repository's merge setting, as the leaf's do today.
    - `reclaim-worktree` runs the same child deletion only when the same shipped-record gate and
      reachability check pass. Otherwise it removes the worktree as today and keeps every child
      branch and the record.
    - Park still never deletes a child branch (umbrella decision 2). When park reconciliation (`reconcileMergedPark`) reclaims a stacked slug, it keeps `positions` and `publication` and marks the record `tornDown`.
    - No glob or computed set is deleted (CLAUDE.md daemon rule 1).

13. **Every new remote write goes through the guarded GitHub boundary under committed ownership.**
    - **New operations:**
      - `stack.read` (read; a repository target to find a stack by PR number, or the new `stack`
        resource kind once its number is known, as `pull-request.read` does today);
      - `stack.create` (create, repository target);
      - `stack.add` (feature-write, the `stack` resource kind identified by stack number);
      - `pull-request.retarget` (feature-write, pull-request target, payload `{base}`).
    - **Payload checks.** The publication module validates every payload against the record before
      it calls the boundary:
      - stack PR numbers are exactly the slug's recorded members;
      - a retarget base is one of this feature's member branches.

      The payload decoder rejects any other shape.
    - **Authorization.**
      - `stack.create` is the second exact-target exemption, beside initial PR creation, and it is
        bound to the leaf's committed ownership.
      - A `stack.add` write is authorized only when its number equals the record's `stack.number`
        and the leaf's committed owner matches. The number is recorded before any add (decision 5). Every child or stack write
      requires the leaf ref to exist (umbrella decision 3) and the feature's committed owner
      (`adr-2026-09-11-github-operation-ownership` D2).
    - Child pushes are `executeRemoteGit` writes. The engine pushes a named ref from the leaf's
      worktree, a narrow exception to "push targets … remain the checked-out branch's own"
      (`adr-2026-09-11-github-operation-ownership` D2).
    - `conduct github-operation` refuses any push to, or PR bind of, a child branch whose member the
      record does not list. An agent therefore cannot publish a child before FINISH does.
    - **Limits.** The engine never merges a member and never touches a ruleset. Every force push
      names its expected SHA.

14. **New events extend the existing union and reach no new channel.**
    - The new members are `stack_member_published`, `stack_member_redrafted`, `stack_assembled`,
      `stack_member_lifecycle`, `stack_members_unreachable` and `stack_tip_diverged`. Each carries
      `child` where it names one member, plus the PR number.
    - FINISH events go through the conductor emitter. Sweep events go through the sweep's existing
      `onEvent`.
    - Each event gets a row in the event-sinks registry. None is emitted for a non-stacked feature.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | `POST /stacks` requires chained bases and accepts draft members | verified | 92% | yes | The retarget or draft-first order would change | — |
| A2 | A PR opened against a child base before joining a stack does not match `branches: [main]`, so the `feat/c*/**` filter is needed for it to get `ci-gate` | inferred | 85% | yes | The filter would be redundant (harmless), or CI may run twice on a member | APPROVED by operator 2026-10-17 |
| A3 | A required-check result bound to a member's head SHA keeps satisfying the ruleset after a base retarget or stack assembly | inferred | 85% | yes | Members would need a CI re-run after assembly, through a new trigger type | APPROVED by operator 2026-10-17 |
| A4 | Squash-merging a stack gives each member its own squash commit on `main`, recorded as that PR's `merge_commit_sha`, rather than one squash for the whole stack | inferred | 80% | yes | Reachability would need content comparison instead of commit ancestry | APPROVED by operator 2026-10-17 |
| A5 | Merging the whole stack at once leaves no server-side rewrite the daemon must act on | inferred | 85% | yes | Whole-stack merges would also need #3268 | APPROVED by operator 2026-10-17 |
| A6 | Every shipment input path (webhook event, `gh pr view`, the audit GraphQL, the reconcile REST payload) can supply the PR head ref | inferred | 90% | yes | The head-ref guard would need new metadata reads | APPROVED by operator 2026-10-17 |
| A7 | FINISH dispatches are exclusive per slug, so two publishers never run concurrently: the daemon tracks an in-flight set (`daemon.ts`, `inFlight`) under a per-repository pidfile lock (`daemon-lock.ts`), and a concurrent interactive `conduct` run on the same slug is an operator error | verified | 90% | yes | Publication would need its own lock | — |
| A8 | Reverts follow GitHub's `Reverts <owner/repo>#<n>` body convention | inferred | 80% | no | Some reverts would go unreported | — |

## Consequences

### Positive
- Stacked features become reviewable as small PRs, while the leaf stays the one ship, the one
  record and the one release note.
- No release or migration contract changes. The one shipment-contract change, the head-ref guard,
  only removes a false-ship path.
- Every member identity and the stack resume from GitHub plus a ref-backed record. Only the leaf's
  prose acceptance keeps today's `.pipeline/`-backed behavior.
- No partial merge or human push can cause a push loop. Engine rewrites of a published stack are
  frozen, and a mismatch halts once and is skipped by the sweep.

### Negative
- Until #3268 and #3270 land, a published stack is handled by hand after publication: `main`
  moving, conflicts, and red CI. Operators should merge a stack in one go.
- The release audit lists children as ordinary `no-note` PRs until #3267.
- Child bodies are generated summaries, not authored prose.
- N members cost N CI runs and N approvals.
- `ci.yml` couples to the engine's child-branch grammar.

### Follow-up Actions
- [ ] #3267, #3268, #3269, #3270 (filed 2026-10-17), and #3273: the `stack-tip-diverged` runbook section, a documentation hotfix after this spec merges. #3268 also owns sweep ci-fix for stacked leaves
      and the open-PR autoresolve replay on a stacked feature.
- [ ] The routed-repair ADR's follow-up "#2945: post a PR comment … and refresh a published stack"
      moves to #3269 and #3268.

## Amendments made by this decision

This decision also narrows, without an amendment note, two decisions of `adr-2026-10-10-stacked-restack-journaled-replay`. Its decision 9 triggers are refused once a stack is published, and refreshing a published stack moves to #3268. Its decision 11 lease table permits only a fast-forward for a published member. Both are governed by decision 11 above, recorded as accepted conflicts in `.docs/conflicts/stacked-features-cannot-be-published-reviewed-and-.md`.


- `adr-2026-07-29-ship-start-draft-pr`: D1.
- `adr-2026-09-24-project-owned-pr-body-regions`: decisions 4, 5, 6, 7, 8.
- `adr-2026-07-25-fail-closed-durable-shipment-evidence`: decisions 3, 4, 5, 7.
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main`: decisions 2, 3, 6, 7.
- `adr-2026-09-11-github-operation-ownership`: D1, D2.
- `adr-2026-10-03-stacked-child-plans-identity-and-state`: decision 2.
- `adr-2026-10-07-per-child-build-region`: decision 11.
- `adr-2026-07-28-total-halt-classification-legacy-boundary`: D1.
- `adr-2026-08-01-multi-proof-park-deletion-authority`: decision 1.
- `adr-2026-09-11-finish-mergeability-respects-active-review-inputs`: decisions 5, 6.
- `adr-2026-07-07-ship-ci-feedback-loop`: decision 2.
- `adr-2026-10-09-shipped-pr-readiness-verdict`: decision 3.
- `adr-2026-08-06-bounded-progress-allowance-for-finish-publication`: D1.
- `adr-2026-08-23-committed-halt-record`: decision 5.
