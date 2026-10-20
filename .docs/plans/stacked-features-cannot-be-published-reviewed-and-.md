# Implementation Plan: Publish, review and ship a stacked feature as a GitHub native stack

**Date:** 2026-10-17
**Design:** .docs/decisions/adr-2026-10-17-stacked-feature-publication-as-native-stack.md
**Stories:** .docs/stories/stacked-features-cannot-be-published-reviewed-and-.md
**Conflict check:** Clean as of 2026-10-17 (.docs/conflicts/stacked-features-cannot-be-published-reviewed-and-.md)

## Summary

This plan delivers the ship-path slice of #2945, using approach B, in 29 tasks:
- FINISH publishes a stacked feature as a GitHub native stack, one draft PR per child, then
  retargets the leaf and assembles the stack;
- every member passes the required checks through existing contracts, plus a CI trigger and a
  head-ref shipment guard;
- only the leaf merging ships the feature, and child branches are torn down by name afterwards;
- a published stack is frozen against engine rewrites, behind a tip guard and the
  `stack-tip-diverged` halt;
- non-stacked features are byte-identical to today.

The operator chose one spec over a split, so the 29 tasks sit in the 21–29 warning band. The
`stack-tip-diverged` runbook is #3273, a documentation hotfix.

## Technical Approach

Governing review: `.docs/decisions/architecture-review-2026-10-17-stacked-features-cannot-be-published-reviewed-and-.md`.
Paths below are under `src/conductor/src/engine/` unless they say otherwise.

- **Freeze N=1 first (Task 1).** Before any production change, the N=1 golden suite is extended to
  freeze:
  - the FINISH `finish_publication_*` event sequence;
  - the recorded gh and git argv;
  - the leaf PR body;
  - `conduct-state.json`;
  - the shipped record's Cost block, plus the Time block's structure.

  Every later task must leave these goldens passing unchanged (ADR decision 1, umbrella decision 14). Per the 2026-10-20 amendment to decision 1, local read-only `refs/conductor/<slug>/` probes are recorded apart from the pinned remote and mutating git argv.
- **Durable state (Tasks 2–3).**
  - `stack-publication-record.ts` owns `refs/conductor/<slug>/publication`, a compare-and-swap ref
    blob `{version, retarget?, stack?, members[], tornDown?}`.
  - Follow the route-record store's pattern (`routing/route-record-store.ts`):
    - read the blob through `git cat-file`;
    - write with `git hash-object -w` plus `update-ref <ref> <new> <old>`;
    - give `create` a zero old value;
    - parse once into a typed value with a version check;
    - keep no in-memory cache.
  - Allowed variation: there is no restack-journal fence.
  - Search hints: `writeRouteRecord`, `routeRefFor`.
  - Events are new members of the `ConductorEvent` union, each with an event-sinks row.
    `stack_member_lifecycle` joins the persister's `eventId` de-duplication set.
- **Observation and selection (Tasks 4–5).**
  - **Observer.** `stack-publication.ts` exports `observeStackDimension`. It answers
    `not-applicable` from local refs alone: no positions ref, one position, or a `tornDown` record.
    Otherwise it reads GitHub.
  - **Snapshot.** The `PublicationSnapshot` in `finish-publication.ts` gains `stack`.
  - **Selection.** `nextFinishPublicationTransition` gains `establish_child_prs` (after
    `establish_pr`) and `assemble_stack` (after `write_shipped_record`). `ready_pr` requires stack
    `valid`, or `not-applicable`.
  - **Allowance.** It becomes twice the number of transitions the feature can select.
- **GitHub boundary (Tasks 6–7).** `github-operations.ts` registers `stack.read`, `stack.create`,
  `stack.add` and `pull-request.retarget`, and the new `stack` resource kind.
  - `ghArgsFor` in `tracker-client.ts` maps them to `gh api` REST calls. Precedent: the
    `commit.status.create` and `issue.dependency.add` cases.
  - `owner-gate/mutation-policy.ts` adds a `stack.create` repository-target exemption beside
    `isInitialPullRequestCreation`.
  - Payloads are validated against the record by `validateStackPayload` in `stack-publication.ts`
    before the boundary is called, because authorization does not see payloads.
  - `pull-request.edit` rejects a `base` field.
- **Children (Tasks 8–10).**
  - **Push.** `pushChildClosure` runs one `ls-remote`.
    - On an absent ref, it plain-pushes the closure SHA from `refs/conductor/<slug>/closed/c<p>`
      through `executeRemoteGit`.
    - On a present ref that is recorded and equal, it does nothing.
    - On anything else it returns `diverged`, and on a failed read `read-failed`.
    - It introduces no new force or lease form.
  - **Chain check.** `verifyChildChain` checks that each next position contains the closure.
  - **Body.** `stack-member-body.ts` renders child bodies deterministically:
    - the slice title;
    - the child's stories and tasks, from the slice manifest and the sealed envelope;
    - a diffstat against the base;
    - the engine-owned `## Stack` section;
    - template-default regions.

    Plan paths are reduced to stems. `checkChildBodyPostconditions` enforces no plan path, no
    closing keyword and default regions.
  - **Transition.** The `establish_child_prs` effect in `finish-publication-production.ts`:
    - iterates the sealed positions;
    - re-drafts a ready leaf;
    - finds PRs by head in any state;
    - creates drafts with chained bases;
    - CAS-writes members.
- **Assembly and lookups (Tasks 11–14).**
  - **Retarget.** `assemble_stack` journals the retarget as `intended`, then calls
    `pull-request.retarget`, then records `observed`.
  - **Stack.** It records the stack number on read or create, adds missing members, then verifies
    order and head SHAs before recording `verified`.
  - **Leaf body.** The leaf's `## Stack` re-render goes through the existing region re-insertion.
  - **Lookups.** `conductor.ts` lookups accept exactly `retarget.from` or `retarget.to`. Shipped
    readiness is untouched.
- **Ready and wiring (Tasks 15–16).**
  - **Flips.** `ready_pr` flips top-down: the leaf through today's `repairPresentation`, children
    through postconditions plus `ensureShipReady`, re-reading the stack before each flip.
  - **Wiring.** Task 16 wires the effects into the production FINISH composition root and owns the
    entry-point integration proof, run through a conductor FINISH dispatch.
- **Required checks (Tasks 17–19).**
  - **CI trigger.** `.github/workflows/ci.yml` gains `feat/c*/**` in its branches filter.
  - **Head-ref guard.** `classifyShipmentAssociation` (`shipment-association.ts`) classifies a
    child head as `stack-child` before reading body declarations.
  - **Adapters.** The CLI reader, the event decoder, the audit query and the reconcile adapter each
    carry the head ref. Premerge fails when the head ref is missing, and reconcile and audit open
    no repair.
- **Freeze and guard (Tasks 20–24).**
  - **Halt class.** `stack-tip-diverged` is added to `halt-marker.ts`, `halt-record.ts` and
    `daemon-rekick.ts`.
  - **Guard.** `stack-tip-guard.ts` runs inside `executeRemoteGit` after push-intent recovery. It
    allows a fast-forward only, after an `ls-remote` shows every member tip matches.
  - **Callers.** Each caller maps a refusal:
    - FINISH halts;
    - halt-record and post-finish pushes skip;
    - agent pushes are refused.
  - **Restack producers.** Each one refuses `published-stack`:
    - base refreshes continue;
    - local-work producers halt `needs-human`;
    - route admission refuses.
  - **ci-fix.** It is ineligible for a stacked feature's leaf.
- **Sweep and teardown (Tasks 25–29).** `mergeable-sweep.ts` keeps one watch entry and the
  unchanged ship gate.
  - **After the gate passes:** it removes the worktree, checks member reachability, deletes child
    branches under the stack-member proof (compare-and-swap with the merged `headRefOid`), then
    deletes the refs. Any kept member marks the record `tornDown`.
  - **While the leaf is open:** it reports member lifecycle.
  - **Reclaim:** `reclaim-worktree` reuses the same deletion helper.

## Prerequisites

- None. #2940–#2944 and #3210 are on main. `stacked_prs` already parses `enabled`, `max_slices`
  and `route_whole_feature_fixes`. No config key is added.

## Task Dependency Graph

```
1 ─┐
2 ─┼─▶ 5 ◀─ 4 ◀─ 3 ─┬─▶ 8 ─┐
   │                ├─▶ 14 │
6 ─┴─▶ 7 ◀──────────┘      │
9 ───────────────────────┐ │
20 ──────────────────────┼─┼─▶ 10 ─▶ 11 ─▶ 12 ─▶ 13 ─▶ 15 ─▶ 16
5, 7 ────────────────────┘ │                          ▲
                           └──────────────────────────┘ (14 ─▶ 16)
17 (independent)
18 ─▶ 19
3, 20 ─▶ 21 ─▶ 22
3 ─▶ 23 ; 3 ─▶ 24 ; 3 ─▶ 25 ─▶ 26 ─▶ 28 ─▶ 29 ; 2, 3 ─▶ 27
```

Each task's `**Dependencies:**` line is authoritative.

## Integration Points

- After Task 12: a stacked fixture can be published and assembled through the coordinator.
- After Task 16: a conductor FINISH dispatch publishes the three-member stack end to end.
- After Task 22: every engine push to a published member passes the tip guard.
- After Task 28: a merged stack is torn down by explicit name.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D1 | task | task-4, task-5, task-1 | adding no gh command and no remote or mutating git command to that observation's recorded argv; local read-only `refs/conductor/<slug>/` probes are admitted (2026-10-20 amendment) |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D2 | task | task-3 | is a compare-and-swap: a write whose expected old value no longer matches is refused and the ref is unchanged |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D3 | task | task-5 | with stack `members-missing` after `establish_pr` it selects `establish_child_prs` |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D4 | task | task-10, task-8 | one `establish_child_prs` effect pushes `feat/c1/demo` then `feat/c3/demo` |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D5 | task | task-11, task-12, task-14 | CAS-writes `retarget {phase: intended}`, calls `pull-request.retarget` |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D6 | task | task-9, task-13 | returns a body titled by the slice name |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D7 | task | task-15 | records `pull-request.ready` for #500, then #c3, then #c1 |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D8 | task | task-17, task-18, task-19 | lists branches `main` and `feat/c*/**` |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D9 | task | task-25, task-26 | finds #c1, #c3 and #500 merged with their squash commits ancestors of `origin/main` |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D10 | task | task-27 | emits one `stack_member_lifecycle` with `child` 1 |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D11 | task | task-21, task-20, task-22, task-23, task-24 | a push whose source does not contain the recorded tip is refused |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D12 | task | task-28, task-29 | deletes `feat/c1/demo` and `feat/c3/demo` by name with those tips as compare-and-swap expected values |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D13 | task | task-7, task-6, task-22 | is refused `other-owner` and the runner is never called |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D14 | task | task-2 | has a registry row for each of the six events |
| adr-2026-07-29-ship-start-draft-pr#D1 | task | task-10, task-15 | converts #500 to draft through `pull-request.draft` before the first child push |
| adr-2026-07-29-ship-start-draft-pr#D2 | existing | none | `openShipDraftPr` in `ship-draft-pr.ts` still opens the leaf draft at SHIP entry behind the injected `GhRunner`/`GitRunner`; this spec adds no second draft-opening path for the leaf. |
| adr-2026-07-29-ship-start-draft-pr#D3 | no-change | none | The ship-start push stays a plain push. Child pushes are separate plain pushes of closure SHAs (Task 8), so no force push is added at ship start. |
| adr-2026-07-29-ship-start-draft-pr#D4 | existing | none | The lazy `rev-list --count <base>..HEAD` check in `openShipDraftPr` is unchanged and still gates the leaf draft. |
| adr-2026-07-29-ship-start-draft-pr#D5 | existing | none | `openShipDraftPr` still logs one `[ship-draft-pr]` line per failure and returns an outcome; the new publication effects run at FINISH, not in this path. |
| adr-2026-07-29-ship-start-draft-pr#D6 | existing | none | `findOrCreatePr` still returns an already-open leaf PR untouched under the per-run latch; child PR discovery is a separate FINISH effect. |
| adr-2026-07-29-ship-start-draft-pr#D7 | task | task-15 | each child through `checkChildBodyPostconditions` and then `ensureShipReady` |
| adr-2026-07-29-ship-start-draft-pr#D8 | existing | none | `shipDraftPrBody` still seeds the leaf placeholder with `PR_BODY_FLOOR_MARKER`; child bodies are rendered by `stack-member-body.ts`, not by this placeholder. |
| adr-2026-07-29-ship-start-draft-pr#D9 | task | task-10 | creates draft PRs with bases `main` and `feat/c1/demo` in that order |
| adr-2026-09-24-project-owned-pr-body-regions#D1 | existing | none | `.github/pull_request_template.md` stays the declaration surface, parsed by `pr-body-regions.ts`; no marker grammar changes. |
| adr-2026-09-24-project-owned-pr-body-regions#D2 | existing | none | Config-load ownership validation of region keys is unchanged; no region owner is added. |
| adr-2026-09-24-project-owned-pr-body-regions#D3 | existing | none | The leaf SHIP draft is still seeded from the template by the ship-start path; child bodies are rendered at FINISH and are not SHIP drafts. |
| adr-2026-09-24-project-owned-pr-body-regions#D4 | task | task-9 | the release-disposition region with `Release-Disposition: no-note` and migration `none` byte-equal to the template default |
| adr-2026-09-24-project-owned-pr-body-regions#D5 | task | task-13 | holds entries only for the leaf PR URL |
| adr-2026-09-24-project-owned-pr-body-regions#D6 | task | task-13 | the leaf's captured project-owned regions are byte-identical before and after that re-render |
| adr-2026-09-24-project-owned-pr-body-regions#D7 | task | task-15 | a child failing `checkChildBodyPostconditions` stays a draft, is never flipped ready |
| adr-2026-09-24-project-owned-pr-body-regions#D8 | task | task-9 | a `## Stack` section listing #c1, #c3 and #500 in order with #c1 marked |
| adr-2026-09-24-project-owned-pr-body-regions#D9 | existing | none | The `release-disposition` step still owns its region on the leaf only; children carry the template default and no owner runs for them. |
| adr-2026-07-25-fail-closed-durable-shipment-evidence#D1 | existing | none | The shared verifier and the single `.docs/shipped/<slug>.md` record are unchanged; only the leaf diff carries the record. |
| adr-2026-07-25-fail-closed-durable-shipment-evidence#D2 | existing | none | `finish-record` and the terminal fail-closed boundaries are unchanged; `finish-record` keeps refusing a child `worktree_branch`. |
| adr-2026-07-25-fail-closed-durable-shipment-evidence#D3 | task | task-18 | returns `not-applicable` classification `stack-child` before reading body declarations |
| adr-2026-07-25-fail-closed-durable-shipment-evidence#D4 | task | task-18 | the premerge check exits non-zero with an error naming the missing head ref |
| adr-2026-07-25-fail-closed-durable-shipment-evidence#D5 | task | task-19 | open no record-only repair PR, and write no `.docs/shipped/demo.md` |
| adr-2026-07-25-fail-closed-durable-shipment-evidence#D6 | no-change | none | The Actions permissions and repository settings are unchanged; no new workflow permission is needed. |
| adr-2026-07-25-fail-closed-durable-shipment-evidence#D7 | task | task-19 | the CLI metadata reader, the event decoder, the audit GraphQL query and the reconcile REST adapter each supply the head ref |
| adr-2026-07-25-fail-closed-durable-shipment-evidence#D8 | existing | none | Records still land on the implementation (leaf) branch before human merge through the existing shipped-record sequence. |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D1 | existing | none | `daemon-runner.ts` still never reaps on `outcome.done`; the reap stays in the mergeable sweep. |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D2 | task | task-28, task-25 | the reap removes the worktree, deletes `feat/c1/demo` and `feat/c3/demo` by name |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D3 | task | task-25 | makes no teardown call, keeps the worktree and every branch, deletes no ref, retains the watch entry |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D4 | existing | none | `mergeable-sweep.ts` still separates MERGED from CLOSED-unmerged through `logDisposition` retention reasons. |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D5 | existing | none | Every reap branch still logs `retained`/`reaped` with its reason through `logDisposition`. |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D6 | task | task-29 | with #500 closed unmerged removes the worktree as today, keeps `feat/c1/demo` and `feat/c3/demo` |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D7 | task | task-28 | a failed delete of `feat/c1/demo` stops the remaining deletes and retains the watch entry |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D8 | task | task-29 | `reconcileMergedPark` on a merged stacked `demo` with kept children deletes neither `refs/conductor/demo/positions` nor `refs/conductor/demo/publication` |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D9 | existing | none | `worktree_reclaim_retained` and its siblings still report every unreclaimed candidate; no new reclaim reason is added. |
| adr-2026-09-11-github-operation-ownership#D1 | task | task-6, task-7 | `GITHUB_OPERATION_REGISTRY` admits `stack.read`, `stack.create`, `stack.add` and `pull-request.retarget` |
| adr-2026-09-11-github-operation-ownership#D2 | task | task-7, task-22 | a child PR create and a child push are each refused `invalid-target` |
| adr-2026-09-11-github-operation-ownership#D3 | no-change | none | Pre-spec intake and creation policy is unchanged; no intake operation is added. |
| adr-2026-09-11-github-operation-ownership#D4 | no-change | none | No shared-resource operation is added; every new operation targets a feature PR, the repository for one feature's stack, or that stack. |
| adr-2026-09-11-github-operation-ownership#D5 | existing | none | `executeRemoteGit` already resolves the destination ref and applies ownership to child refs through `daemonOwnedSlugOfRef`; child pushes reuse it. |
| adr-2026-09-11-github-operation-ownership#D6 | existing | none | The new refusals reuse the existing typed reasons `invalid-payload`, `invalid-target` and `other-owner`. |
| adr-2026-09-11-github-operation-ownership#D7 | task | task-6 | the static GitHub-invocation audit passes with the four new operations registered |
| adr-2026-09-11-github-operation-ownership#D8 | no-change | none | No gated-visibility write is introduced. |
| adr-2026-09-11-github-operation-ownership#D9 | no-change | none | Write credentials remain a transport property; the new operations use the same runner transport. |
| adr-2026-09-11-github-operation-ownership#D10 | no-change | none | Commit authorship and bot co-author crediting are unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D1 | existing | none | `feature-branch-identity.ts` stays the only branch-identity owner; this spec consumes `parseFeatureBranch`, `childBranchFor` and `leafBranchFor`. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D2 | task | task-28, task-29 | park reconciliation of a parked `demo` deletes no child branch, as today |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D3 | task | task-7 | with `feat/daemon-demo` absent locally and on `origin`, a child PR create and a child push are each refused `invalid-target` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D4 | existing | none | The `feat/c<k>` namespace and its parser are unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D5 | existing | none | `ChildId` (1..9) and sealed positions in `child-context.ts` are unchanged; publication iterates the sealed positions. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D6 | existing | none | The leaf is still `feat/daemon-<slug>` at the highest position via `leafBranchFor`. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D7 | existing | none | Positions stay immutable once a child exists; publication only reads `refs/conductor/<slug>/positions`. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D8 | existing | none | Per-child stores under `.pipeline/children/<k>/` are unchanged; FINISH and the publication record stay whole-feature. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D9 | existing | none | Region caps per child are unchanged; publication runs after the region. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D10 | existing | none | The active-child contract implemented by #2942 is unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D11 | existing | none | The base-override contract implemented by #2942 is unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D12 | task | task-2 | `child` is set only on events naming one member |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | existing | none | The recovery CLIs keep their `--child <k>` contract; no recovery CLI changes. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | task | task-1 | are byte-identical to their committed golden files |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | existing | none | Whole-feature rubrics still run once at the leaf; publication happens after them. |
| adr-2026-10-07-per-child-build-region#D1 | existing | none | The cursor and closure refs `refs/conductor/<slug>/closed/c<k>` are unchanged; Task 8 pushes the closure SHA they record. |
| adr-2026-10-07-per-child-build-region#D2 | task | task-4 | returns `members-missing`, so the feature is published as a stack from its sealed positions alone |
| adr-2026-10-07-per-child-build-region#D3 | existing | none | Child creation, switching and the leaf move are unchanged. |
| adr-2026-10-07-per-child-build-region#D4 | existing | none | The region overlay and routed write port are unchanged. |
| adr-2026-10-07-per-child-build-region#D5 | existing | none | Per-child acceptance specs are unchanged. |
| adr-2026-10-07-per-child-build-region#D6 | existing | none | Per-child build, stall detection and the commit hook are unchanged. |
| adr-2026-10-07-per-child-build-region#D7 | existing | none | Per-child `test_suite` with the aggregate at the leaf is unchanged; member CI now runs on each child PR (Task 17). |
| adr-2026-10-07-per-child-build-region#D8 | existing | none | `resolveChildBase` remains the single base producer; the child diffstat uses the same base. |
| adr-2026-10-07-per-child-build-region#D9 | existing | none | Child-local `build_review` and the leaf security rubric are unchanged. |
| adr-2026-10-07-per-child-build-region#D10 | existing | none | Per-child caps are unchanged. |
| adr-2026-10-07-per-child-build-region#D11 | task | task-8 | pushes the closure SHA with a plain push whose argv contains no `--force` |
| adr-2026-10-07-per-child-build-region#D12 | existing | none | The rebase guard was lifted by #2943; this spec adds the published-stack refusal under the restack ADR instead. |
| adr-2026-10-07-per-child-build-region#D13 | existing | none | `child_started`, `child_closed` and `child_switched` are unchanged. |
| adr-2026-10-07-per-child-build-region#D14 | task | task-1 | are byte-identical to their committed golden files |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D1 | task | task-20 | `readHaltClass` accepts `stack-tip-diverged` |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D2 | existing | none | Read disposition already retains an unknown class; `stack-tip-diverged` is added to the explicit allowlist instead. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D3 | no-change | none | The one-time legacy migration is unchanged and never stamps the new class. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D4 | existing | none | Marker and sidecar lifecycle is unchanged. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D5 | existing | none | `writeHaltMarker` still requires a class argument, so `haltStackTipDiverged` passes it explicitly. |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D6 | task | task-20 | `haltStackTipDiverged` writes a `stack-tip-diverged` HALT |
| adr-2026-07-28-total-halt-classification-legacy-boundary#D7 | no-change | none | ADR-013's non-classification decisions are unchanged. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D1 | task | task-28 | with those tips as compare-and-swap expected values |
| adr-2026-08-01-multi-proof-park-deletion-authority#D2 | no-change | none | The stack-member proof is recorded in this ADR's decision 1 amendment before it ships, as decision 2 requires. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D3 | existing | none | Park refusal reasons are unchanged; park never deletes a child branch. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D4 | existing | none | Sweep refusal counts are unchanged. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D5 | no-change | none | Park deletion strength is unchanged; the new proof applies only to shipped-record teardown and reclaim. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D6 | existing | none | The park helper still enumerates the worktree listing. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D7 | existing | none | Park proofs are still keyed on the worktree's listed branch. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D8 | existing | none | The shipped-record precondition by branch kind is unchanged. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D9 | existing | none | Ancestry alone still never authorizes park deletion. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D10 | existing | none | A dirty worktree is still never removed by park. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D11 | existing | none | Park refusals are still reported through `worktree_reclaim_retained`. |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D1 | existing | none | The finish versus re-kick distinction and the incomplete-rebase guard are unchanged. |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D2 | existing | none | Mergeable-skip at normal finish is unchanged. |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D3 | existing | none | Review-input invalidation is unchanged. |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D4 | existing | none | Conflicting prospective merges still enter the bounded rebase flow, except when the stack is published (Task 23). |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D5 | task | task-23 | re-kick retries its gate on the current base |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D6 | task | task-23 | FINISH selects its next step |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D7 | no-change | none | Coverage binding stays non-tree-attesting. |
| adr-2026-07-07-ship-ci-feedback-loop#D1 | existing | none | `PrMergeState` check classification is unchanged. |
| adr-2026-07-07-ship-ci-feedback-loop#D2 | task | task-24 | the sweep's ci-fix eligibility returns ineligible |
| adr-2026-07-07-ship-ci-feedback-loop#D3 | existing | none | The bounded `CiFixDispatchOpts` dispatch seam is unchanged. |
| adr-2026-07-07-ship-ci-feedback-loop#D4 | existing | none | The ci-fix remediation run is unchanged. |
| adr-2026-07-07-ship-ci-feedback-loop#D5 | existing | none | ci-fix exhaustion handling is unchanged. |
| adr-2026-07-07-ship-ci-feedback-loop#D6 | no-change | none | `ci_watch.enabled` keeps its default. |
| adr-2026-07-07-ship-ci-feedback-loop#D7 | no-change | none | Fixture-portability guards are unchanged. |
| adr-2026-10-09-shipped-pr-readiness-verdict#D1 | existing | none | The pure readiness classifier is unchanged. |
| adr-2026-10-09-shipped-pr-readiness-verdict#D2 | task | task-14 | returns `ci-pending`, and the label plan adds nothing |
| adr-2026-10-09-shipped-pr-readiness-verdict#D3 | task | task-24 | escalates through autoresolve's `published-stack` path, and no ci-fix dispatch is recorded |
| adr-2026-10-09-shipped-pr-readiness-verdict#D4 | no-change | none | Readiness still adds no GitHub operation; the stack operations belong to publication, not readiness. |
| adr-2026-10-09-shipped-pr-readiness-verdict#D5 | existing | none | `shipped_pr_readiness` events are unchanged. |
| adr-2026-10-09-shipped-pr-readiness-verdict#D6 | existing | none | `daemon status` SHIPPED PRS is unchanged. |
| adr-2026-10-09-shipped-pr-readiness-verdict#D7 | existing | none | Grace bookkeeping in the watch entry is unchanged. |
| adr-2026-08-06-bounded-progress-allowance-for-finish-publication#D1 | task | task-5 | the progress allowance is 2 × 7 for an N=1 feature and 2 × 9 for the three-member stack |
| adr-2026-08-06-bounded-progress-allowance-for-finish-publication#D2 | existing | none | The allowance counter is still scoped to one `finish` execution. |
| adr-2026-08-06-bounded-progress-allowance-for-finish-publication#D3 | no-change | none | No per-transition stuck cap is added. |
| adr-2026-08-06-bounded-progress-allowance-for-finish-publication#D4 | existing | none | Allowance exhaustion still halts `needs-human`. |
| adr-2026-08-23-committed-halt-record#D1 | existing | none | `.docs/halted/<slug>.md` is unchanged and is written on the leaf. |
| adr-2026-08-23-committed-halt-record#D2 | existing | none | The record is still produced at the single `writeHaltMarker` seam. |
| adr-2026-08-23-committed-halt-record#D3 | task | task-20 | `isRecordableHaltClass('stack-tip-diverged')` is true |
| adr-2026-08-23-committed-halt-record#D4 | existing | none | Record content is unchanged; a `stack-tip-diverged` record names the mismatched members in its body. |
| adr-2026-08-23-committed-halt-record#D5 | task | task-22 | `halt_record_push_failed` is emitted with reason `stack-tip-mismatch` |
| adr-2026-08-23-committed-halt-record#D6 | existing | none | Nothing in the record path throws; the guard refusal is mapped to a skip. |
| adr-2026-08-23-committed-halt-record#D7 | existing | none | Resume supersedes the record in place, unchanged. |
| adr-2026-08-23-committed-halt-record#D8 | no-change | none | The record stays durable state, not a channel. |

## Tasks

### Task 1: Freeze the N=1 FINISH goldens before any change
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write tests in `src/conductor/test/engine/n1-golden-renderings.test.ts` for an N=1 FINISH run through `advanceFinishPublication`, with the existing fake `gh` and a `PATH`-shimmed `git`. They record the `finish_publication_*` event sequence, the gh and git argv, the leaf PR body, `conduct-state.json` and the shipped record. Commit the goldens under `src/conductor/test/fixtures/n1-golden/finish/`.
2. Add a resumed-run case: the run is interrupted after `author_pr_prose` and re-entered.
3. These freeze today's behavior, so they pass on the current engine. Every later task must leave them passing.
4. Commit.

**Done when:**
- [test] `n1-golden-renderings.test.ts` asserts, for an N=1 FINISH run, that the leaf PR body, `conduct-state.json`, the recorded gh and git argv list and the `finish_publication_*` event sequence are byte-identical to their committed golden files.
- [test] the same test asserts the shipped record's Cost block is byte-identical to its golden and its Time block has the golden's section and field structure, with timing values normalized.
- [test] an N=1 FINISH run interrupted after `author_pr_prose` and resumed records the same transition sequence as its resume golden, and its git argv names no `refs/conductor/<slug>/publication` ref.

**Files likely touched:**
- `src/conductor/test/engine/n1-golden-renderings.test.ts` — FINISH goldens
- `src/conductor/test/fixtures/n1-golden/finish/` — golden files

**Dependencies:** none

### Task 2: Stack events on the existing spine
**Story:** 9
**Type:** infrastructure

**Steps:**
1. Write failing tests:
   - `src/conductor/test/types/stack-events.test.ts`: shapes;
   - `src/conductor/test/engine/event-sinks.test.ts`: registry completeness;
   - `src/conductor/test/engine/event-persister.test.ts`: `eventId` de-duplication of `stack_member_lifecycle`;
   - `src/conductor/test/engine/finish-publication-dimensions.test.ts`: dimension map.
2. Verify RED.
3. Implement. In `src/conductor/src/types/events.ts`:
   - add `stack_member_published`, `stack_member_redrafted`, `stack_assembled`, `stack_member_lifecycle` (`state: merged|closed|reverted`, `eventId`), `stack_members_unreachable` and `stack_tip_diverged`;
   - each carries `pr` numbers, with `child` only where it names one member;
   - extend `FinishPublicationTransition` with `establish_child_prs` and `assemble_stack`.

   In `event-sinks.ts`, add one row per event. In `event-persister.ts`, add `stack_member_lifecycle` to the replay-deduplicated set. In `finish-publication.ts`, map both transitions to a new `stack` dimension.
4. Verify GREEN, commit.

**Done when:**
- [test] `types/events.ts` declares `stack_member_published`, `stack_member_redrafted`, `stack_assembled`, `stack_member_lifecycle`, `stack_members_unreachable` and `stack_tip_diverged`, and `stack-events.test.ts` asserts each carries a PR number and that `child` is set only on events naming one member.
- [test] `event-sinks.ts` has a registry row for each of the six events, asserted by the event-sinks registry completeness test.
- [test] `EventPersister` de-duplicates `stack_member_lifecycle` by `eventId`: persisting the same event twice leaves one ledger line.
- [test] `FinishPublicationTransition` includes `establish_child_prs` and `assemble_stack`, and `PUBLICATION_TRANSITION_DIMENSIONS` maps both to the `stack` dimension.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — event members and transition union
- `src/conductor/src/engine/event-sinks.ts` — registry rows
- `src/conductor/src/engine/event-persister.ts` — de-duplication set
- `src/conductor/src/engine/finish-publication.ts` — dimension map
- `src/conductor/test/types/stack-events.test.ts`, `src/conductor/test/engine/event-sinks.test.ts`, `src/conductor/test/engine/event-persister.test.ts`, `src/conductor/test/engine/finish-publication-dimensions.test.ts` — tests

**Dependencies:** none

### Task 3: Ref-backed publication record
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-publication-record.test.ts` over a real-git fixture.
2. Verify RED.
3. Implement `stack-publication-record.ts`:
   - `publicationRefFor(slug)`;
   - `readPublicationRecord`, which parses once with a version check;
   - `writePublicationRecord(expectedOld, next)`, which uses `hash-object -w` and `update-ref <ref> <new> <old>`, with a zero old value for create;
   - `activePublicationRecord`, which returns `undefined` for a `tornDown` record.

   Follow `routing/route-record-store.ts` (`writeRouteRecord`): explicit old values, no cache, CAS refusal returned as a value.
4. Verify GREEN, commit.

**Done when:**
- [test] `readPublicationRecord` and `writePublicationRecord` round-trip `{version: 1, retarget, stack, members}` through `refs/conductor/demo/publication` in a real-git fixture, with `members` ordered by sealed position.
- [test] `writePublicationRecord` is a compare-and-swap: a write whose expected old value no longer matches is refused and the ref is unchanged.
- [test] `activePublicationRecord` returns `undefined` for a record marked `tornDown`, and a create for the same slug replaces the torn-down record.
- [test] a record with an unknown `version`, or a member without a PR number, fails to parse with a named diagnostic.

**Files likely touched:**
- `src/conductor/src/engine/stack-publication-record.ts` — new store
- `src/conductor/test/engine/stack-publication-record.test.ts` — tests

**Dependencies:** none

### Task 4: Stack observer decides stacked publication from sealed positions
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-publication-observe.test.ts`, with an argv-recording fake `gh` and `git`, over these fixtures:
   - N=1;
   - one position;
   - three positions with the flag off;
   - no record;
   - members without a verified stack;
   - a verified stack;
   - a closed member;
   - a stack read timeout;
   - a `tornDown` record.
2. Verify RED.
3. Implement `observeStackDimension(root, slug, cursor, deps)` in `stack-publication.ts`. It takes the cursor that the same observation already resolved for `observeImplementationEvidence` (`resolveActiveChild`, one call per observation, shared through a per-observation memo), and returns `not-applicable` for `no-child` without any further git or GitHub command. Only with durable child state does it read the positions ref (`child-lifecycle.ts`) and `activePublicationRecord`, and return `not-applicable` for fewer than two positions. The `stacked_prs.enabled` value is never consulted, because durable child state is authoritative (build-region decision 2).
4. Verify GREEN, commit.

**Done when:**
- [test] `observeStackDimension` returns `not-applicable` for an N=1 feature from the observation's already-resolved `no-child` cursor, adding no git or gh command to that observation's recorded argv, and for a positions ref with one position with no gh command and no `ls-remote`, and in both cases no `refs/conductor/<slug>/publication` ref written.
- [test] for the three-member fixture with `stacked_prs.enabled: false`, `observeStackDimension` returns `members-missing`, so the feature is published as a stack from its sealed positions alone.
- [test] the observer returns `members-missing`, `unassembled`, `valid`, `diverged` and `indeterminate` for the no-record, unverified, verified, closed-member and read-timeout fixtures respectively.
- [test] with a `tornDown` record for `demo`, a new feature reusing slug `demo` observes `members-missing`, and its first record write replaces the old record.

**Files likely touched:**
- `src/conductor/src/engine/stack-publication.ts` — observer
- `src/conductor/test/engine/stack-publication-observe.test.ts` — tests

**Dependencies:** Task 3

### Task 5: Transition selection and the per-feature allowance
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication.test.ts`:
   - snapshot sequences for N=1 and stacked features;
   - the allowance;
   - the movement guard.

   Update `src/conductor/test/engine/finish-pr-prose-authoring.test.ts`'s allowance pin to the per-feature form.
2. Verify RED.
3. Implement in `finish-publication.ts`:
   - `PublicationSnapshot.stack`;
   - `nextFinishPublicationTransition`, which returns `establish_child_prs` after `establish_pr` when the stack is `members-missing`, and `assemble_stack` after `write_shipped_record` when the stack is `unassembled`, and never returns `ready_pr` unless the stack is `valid` or `not-applicable`;
   - `publicationProgressAllowance(snapshot)`, which is 2 × the selectable transition count: 7 when `not-applicable`, else 9.

   The observer from Task 4 feeds `stack`.
4. Verify GREEN, commit.

**Done when:**
- [test] with stack `not-applicable`, `nextFinishPublicationTransition` selects today's seven transitions in today's order for the N=1 snapshot sequence, and the run emits no `stack_*` event and `finish_publication_transition` events naming only those seven.
- [test] with stack `members-missing` after `establish_pr` it selects `establish_child_prs`, with stack `unassembled` after `write_shipped_record` it selects `assemble_stack`, and it never selects `ready_pr` unless the stack dimension is `valid` or `not-applicable`.
- [test] the progress allowance is 2 × 7 for an N=1 feature and 2 × 9 for the three-member stack.
- [test] a successful `establish_child_prs` that moves the stack dimension from `members-missing` to `unassembled` counts as an advance, not `publication_transition_unmoved`.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication.ts` — snapshot, selection, allowance
- `src/conductor/test/engine/finish-publication.test.ts`, `src/conductor/test/engine/finish-pr-prose-authoring.test.ts` — tests

**Dependencies:** Task 2, Task 4

### Task 6: Guarded stack and retarget operations
**Story:** 12
**Type:** infrastructure

**Steps:**
1. Write failing tests:
   - `src/conductor/test/engine/github-operations-stack.test.ts`: registry, decoder, argv;
   - `src/conductor/test/engine/github-invocation-audit.test.ts`: the static audit.
2. Verify RED.
3. Implement:
   - in `github-operations.ts`, registry entries for `stack.read`, `stack.create`, `stack.add` and `pull-request.retarget`, the `stack` resource kind (`{repository, number}`), payload kinds, and decoders;
   - in `tracker-client.ts` `ghArgsFor`:
     - `gh api --method POST repos/<r>/stacks -F pull_requests[]=…`;
     - `POST repos/<r>/stacks/<n>/add`;
     - `GET repos/<r>/stacks?pull_request=<n>` or `repos/<r>/stacks/<n>`;
     - `gh pr edit <n> -R <r> --base <base>` for retarget.
   - the `pull-request.edit` decoder rejects a `base` field.

   Precedent: the `commit.status.create` and `issue.dependency.add` cases.
4. Verify GREEN, commit.

**Done when:**
- [test] `GITHUB_OPERATION_REGISTRY` admits `stack.read`, `stack.create`, `stack.add` and `pull-request.retarget`, and `ghArgsFor` maps `stack.create` to `gh api --method POST repos/jstoup111/ai-conductor/stacks` with the PR numbers bottom to top.
- [test] `ghArgsFor` maps `stack.add` to `POST repos/<repo>/stacks/<n>/add`, `stack.read` to `GET repos/<repo>/stacks?pull_request=<n>` or `repos/<repo>/stacks/<n>`, and `pull-request.retarget` to a `gh pr edit` argv whose only edited field is `--base`.
- [test] decoding a `pull-request.edit` payload that carries `base` is refused with `invalid-payload`, so no `pull-request.edit` argv can contain `--base`.
- [test] the static GitHub-invocation audit passes with the four new operations registered.

**Files likely touched:**
- `src/conductor/src/engine/github-operations.ts` — registry, kinds, decoders
- `src/conductor/src/engine/tracker-client.ts` — argv
- `src/conductor/src/engine/github-invocation-audit.ts` — audit registration
- `src/conductor/test/engine/github-operations-stack.test.ts`, `src/conductor/test/engine/github-invocation-audit.test.ts` — tests

**Dependencies:** none

### Task 7: Stack writes are bound to committed ownership and the record
**Story:** 12
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/owner-gate/mutation-policy-stack.test.ts` and `src/conductor/test/engine/stack-publication-payload.test.ts`. Mock the runner boundary and assert that refused calls never reach it.
2. Verify RED.
3. Implement:
   - in `owner-gate/mutation-policy.ts`, an `isInitialStackCreation` exemption beside `isInitialPullRequestCreation`, bound to the leaf's committed ownership, and the `stack` target match;
   - in `stack-publication.ts`, `validateStackPayload(record, request)`. It refuses a stack PR set that is not exactly the record's members, a retarget base that is not a member branch, and a `stack.add` number that differs from `record.stack.number`.
4. Verify GREEN, commit.

**Done when:**
- [test] with the operator as committed owner and `feat/daemon-demo` present, `stack.create` for the record's members #c1, #c3 and #500, `stack.add` and `stack.read` with the record's stack number, and `pull-request.retarget` of #500 to `feat/c3/demo` are each authorized and reach the mocked runner.
- [test] `validateStackPayload` refuses with `invalid-payload`, before any runner call, a `stack.create` that names a PR not recorded for `demo` and a `pull-request.retarget` whose base is not one of `demo`'s member branches.
- [test] with another operator as committed owner, each of `stack.read`, `stack.create`, `stack.add` and `pull-request.retarget` is refused `other-owner` and the runner is never called.
- [test] with `feat/daemon-demo` absent locally and on `origin`, a child PR create and a child push are each refused `invalid-target`.
- [test] a `stack.add` for a stack number other than the record's `stack.number` is refused `invalid-target`.

**Files likely touched:**
- `src/conductor/src/engine/owner-gate/mutation-policy.ts` — exemption and target match
- `src/conductor/src/engine/stack-publication.ts` — payload validation
- `src/conductor/test/engine/owner-gate/mutation-policy-stack.test.ts`, `src/conductor/test/engine/stack-publication-payload.test.ts` — tests

**Dependencies:** Task 3, Task 6

### Task 8: Push a child's closure with a plain push after one ls-remote
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-child-push.test.ts` with a real-git bare `origin`. Each outcome is asserted on the recorded git argv.
2. Verify RED.
3. Implement in `stack-publication.ts`:
   - `verifyChildChain(positions)`: each next position's branch contains the previous closure;
   - `pushChildClosure(slug, position)`: one `ls-remote --heads origin refs/heads/feat/c<p>/<slug>`, then:
     - absent: a plain push of `refs/conductor/<slug>/closed/c<p>`'s SHA to `refs/heads/feat/c<p>/<slug>` through `executeRemoteGit`, which records the pushed tip;
     - present and equal to both the recorded tip and the closure: `unchanged`;
     - otherwise: `diverged`;
     - a failed read: `read-failed`.

   It introduces no force or lease form.
4. Verify GREEN, commit.

**Done when:**
- [test] for each of `feat/c1/demo` and `feat/c3/demo`, `pushChildClosure` runs one `ls-remote`, finds the branch absent, pushes the closure SHA with a plain push whose argv contains no `--force`, and records the pushed tip for that branch.
- [test] when `ls-remote` shows `feat/c3/demo` present at a SHA the engine never recorded pushing, `pushChildClosure` makes no push, the remote branch is unchanged, and it returns `diverged` naming position 3.
- [test] when `feat/c1/demo` carries a halt-record-only commit past its closure, the pushed SHA is the closure SHA, the halt-record commit is not on `origin`, the result is `pushed`, and `establish_child_prs` on that fixture completes with no HALT written.
- [test] a failing `ls-remote` returns `read-failed`, which `establish_child_prs` reports as a retryable publication failure with no HALT written, and no push argv is recorded.
- [test] `verifyChildChain` returns `broken` naming position 1 when `feat/c3/demo` does not contain child 1's closure.

**Files likely touched:**
- `src/conductor/src/engine/stack-publication.ts` — `pushChildClosure`, `verifyChildChain`
- `src/conductor/src/engine/remote-git-operations.ts` — named-ref source for a plain push
- `src/conductor/test/engine/stack-child-push.test.ts` — tests

**Dependencies:** Task 3

### Task 9: Engine-rendered child bodies and their postconditions
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-member-body.test.ts`. The fixtures are the slice manifest, the sealed envelope `taskSlices`, the repository PR template, and a no-template project.
2. Verify RED.
3. Implement `stack-member-body.ts`:
   - `renderChildBody(input)` composes:
     - the title from the slice name;
     - a summary of the child's stories (title and id) and tasks;
     - a diffstat of the child branch against its base;
     - `renderStackNavigation(members, current)`;
     - every `<!-- ai-conductor:step -->` region from the template at its default.

     Plan paths found by the `extractPlanStems` regex are rewritten to their stem.
   - `checkChildBodyPostconditions(body, template)` refuses a body with a plan path, an issue-closing keyword, or non-default regions, naming the member.
4. Verify GREEN, commit.

**Done when:**
- [test] `renderChildBody` for child 1 returns a body titled by the slice name, listing stories `S-A` and `S-B` with their ids and task `T1`, a diffstat of `feat/c1/demo` against `main`, a `## Stack` section listing #c1, #c3 and #500 in order with #c1 marked, and the release-disposition region with `Release-Disposition: no-note` and migration `none` byte-equal to the template default.
- [test] a story title containing the plan path `.docs/plans/<stem>.md` is rendered as the plan stem only, and the rendered body matches no `.docs/plans/<stem>.md` string under the reconcile `extractPlanStems` regex.
- [test] with no PR template, `renderChildBody` returns the title, summary, diffstat and `## Stack` section, and no project-owned region: no `<!-- ai-conductor:step` marker and no `Release-Disposition` line.
- [test] `checkChildBodyPostconditions` refuses, naming the member, a body containing `Closes jstoup111/ai-conductor#2945` and a body whose release-disposition region differs from the template default.

**Files likely touched:**
- `src/conductor/src/engine/stack-member-body.ts` — renderer and postconditions
- `src/conductor/test/engine/stack-member-body.test.ts` — tests

**Dependencies:** none

### Task 10: establish_child_prs publishes every child as a chained draft in one effect
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-establish-children.test.ts`, using the three-member fixture (positions 1, 3, 5) with a real-git `origin` and an argv-recording fake `gh`. Add crash-injection at each record write and each GitHub write.
2. Verify RED.
3. Implement the `establishChildPrs` effect in `finish-publication-production.ts`, backed by `stack-publication.ts`:
   1. If the leaf PR is ready, convert it to draft through `pull-request.draft` and emit `stack_member_redrafted`.
   2. Run every check before the first push: `verifyChildChain`, the record, a PR list for every child head in every state, one `ls-remote` per child, and rendering every child body with `checkChildBodyPostconditions`. Return `diverged`, `broken` or a postcondition halt from this phase without pushing anything.
   3. For each sealed child position in order:
      - run `pushChildClosure`;
      - list PRs for the head in every state;
      - adopt the open draft with the expected base, or create a draft from the already-checked Task 9 body with base `«default»` for the first position, otherwise the previous position's branch;
      - CAS-write the member and emit `stack_member_published`.
   Record the leaf as the last member (its position, `feat/daemon-<slug>` and the retained draft's PR number).
   4. After an ambiguous create error, re-list before any retry.
   5. Return `diverged` for a closed or merged member, a ready child, a wrong base, or a `diverged` push. Return `broken` for a broken chain. Return a retryable failure for `read-failed`.
4. Verify GREEN, commit.

**Done when:**
- [test] on the three-member fixture, one `establish_child_prs` effect pushes `feat/c1/demo` then `feat/c3/demo` and creates draft PRs with bases `main` and `feat/c1/demo` in that order, and the interleaved git and gh argv shows push `feat/c1/demo`, then create its draft, then push `feat/c3/demo`, then create its draft.
- [test] after the effect the record lists positions 1, 3 and 5 in order, each with its branch and PR number, position 5 being `feat/daemon-demo` with #500, and one `stack_member_published` event carrying `child` and the PR number was emitted per child.
- [test] with leaf #500 ready before FINISH, the effect converts #500 to draft through `pull-request.draft` before the first child push and emits `stack_member_redrafted`.
- [test] after a crash between child 1's PR create and the record write, the resumed effect finds that PR by head in any state and records it, with exactly one PR create for `feat/c1/demo` in the argv; after an ambiguous create error for child 3, the retry lists PRs for `feat/c3/demo` in every state before any create, creates no PR when that list finds one, and creates exactly one when it is empty.
- [test] a recorded child PR that is closed or merged, an open `feat/c3/demo` PR with a base other than `feat/c1/demo`, or a `diverged` push sets the stack dimension `diverged` and halts `stack-tip-diverged` naming that position, a `broken` chain halts `needs-human` naming position 1, a recorded child PR already ready for review before assembly sets `diverged` and halts `stack-tip-diverged` naming it, a child whose rendered body fails `checkChildBodyPostconditions` gets no `pull-request.create` and halts `needs-human` naming it, and in each case the effect's recorded git argv contains no push at all.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication-production.ts` — `establishChildPrs` effect
- `src/conductor/src/engine/stack-publication.ts` — member discovery and creation
- `src/conductor/test/engine/finish-publication-establish-children.test.ts` — tests

**Dependencies:** Task 5, Task 7, Task 8, Task 9, Task 20

### Task 11: The leaf retarget is journaled and applied exactly once
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-assemble-stack.test.ts` for the retarget, with crash-injection before and after the `pull-request.retarget` call.
2. Verify RED.
3. Implement the first half of the `assembleStack` effect:
   1. If #500's base is `«default»`, CAS-write `retarget {from, to, phase: 'intended'}`.
   2. Call `pull-request.retarget`.
   3. Re-read the PR and CAS-write `phase: 'observed'`.

   On resume, read the PR first. When its base already equals `retarget.to`, skip the call.
4. Verify GREEN, commit.

**Done when:**
- [test] `assemble_stack` CAS-writes `retarget {phase: intended}`, calls `pull-request.retarget` setting #500's base to `feat/c3/demo`, then CAS-writes `phase: observed`, in that argv order.
- [test] after a crash between the intended write and the call, the resume finds #500 under base `main`, issues exactly one `pull-request.retarget`, and the record reaches `observed`.
- [test] after a crash between the call and the observed write, the resume finds #500 under base `feat/c3/demo`, issues no `pull-request.retarget`, and the record reaches `observed`.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication-production.ts` — `assembleStack` retarget phase
- `src/conductor/src/engine/stack-publication.ts` — retarget journal
- `src/conductor/test/engine/finish-publication-assemble-stack.test.ts` — tests

**Dependencies:** Task 10

### Task 12: The stack is created or extended, then verified before it is trusted
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-assemble-stack.test.ts`. The fixtures are: no stack, a one-member prefix, a foreign stack, a wrong order, a head SHA mismatch, and a read timeout.
2. Verify RED.
3. Implement the second half of `assembleStack`:
   1. Run `stack.read` by member 1's PR number.
   2. With no stack, run `stack.create` bottom up. With a prefix in the correct order, record the number, then `stack.add` the missing members.
   3. Record `stack: {number, verified: false}` as soon as the number is known.
   4. Re-read and compare the order with `members`, and each head SHA with `refs/conductor/<slug>/pushed/<branch>`.
   5. CAS-write `verified: true` and emit `stack_assembled`.

   Any other shape is `diverged`. A read timeout is `indeterminate`.
4. Verify GREEN, commit.

**Done when:**
- [test] with no existing stack, `assemble_stack` calls `stack.create` with #c1, #c3 and #500 bottom to top, records the stack number, re-reads the stack, finds member order equal to the record and each head SHA equal to its recorded pushed tip, then marks the record's stack verified and emits `stack_assembled`.
- [test] with a stack holding #c1 alone, `assemble_stack` records that stack's number before calling `stack.add` once with #c3 and #500, and the argv contains no `stack.create`.
- [test] with #c3 in a different stack, the stack's order differing from the record, or a stack holding #c1 and #500 only (a missing middle), the stack dimension is `diverged`, the feature halts `stack-tip-diverged`, and the argv contains no `stack.create` or `stack.add`.
- [test] with a member's head SHA differing from its recorded pushed tip after assembly, the record's stack is not marked verified, the feature halts `stack-tip-diverged` naming that member, and `ready_pr` is never selected.
- [test] a timed-out `stack.read` makes the stack dimension `indeterminate`, it is retried through today's indeterminate routing, and no `pull-request.ready` call is recorded.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication-production.ts` — `assembleStack` stack phase
- `src/conductor/src/engine/stack-publication.ts` — stack read, create, add and verify
- `src/conductor/test/engine/finish-publication-assemble-stack.test.ts` — tests

**Dependencies:** Task 11

### Task 13: The leaf carries the feature's content and its regions survive the stack re-render
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-leaf-body.test.ts`, with a captured `release-disposition` region on the leaf and a membership change during publication.
2. Verify RED.
3. Implement:
   - `assembleStack` re-renders `## Stack` on every member through `renderStackNavigation`;
   - for the leaf, it goes through the existing FINISH body rewrite path, which re-inserts captured regions (`pr-body-regions.ts` `restoreRegion`);
   - `pr-body-region-store.ts` captures are keyed only by the leaf PR URL.
4. Verify GREEN, commit.

**Done when:**
- [test] in a fixture where a member's PR was created after the other members' `## Stack` sections were first rendered, after `assemble_stack` every member's `## Stack` section lists the final ordered membership, and the leaf's captured project-owned regions are byte-identical before and after that re-render.
- [test] the leaf body after FINISH keeps today's authored prose, release note, `Plan:` declaration, `Closes` reference, build-review blocks and migration section, gains a `## Stack` section with #500 marked, and across all member bodies the release note, `Plan:`, `Closes` and migration each appear exactly once.
- [test] the `## Stack` re-render of a child runs `checkChildBodyPostconditions` before its `pull-request.edit`, and a failing body makes no edit and halts `needs-human` naming the member.
- [test] after publication `.pipeline/pr-body-region-captures.json` holds entries only for the leaf PR URL, a spy on the capture store records no read for any child PR URL while child bodies are rendered, and the leaf's captured region is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/stack-publication.ts` — `## Stack` re-render
- `src/conductor/src/engine/pr-body-regions.ts` — leaf re-insertion path
- `src/conductor/test/engine/stack-leaf-body.test.ts` — tests

**Dependencies:** Task 9, Task 12

### Task 14: Leaf lookups accept exactly the two journaled bases
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-retained-draft-retarget.test.ts`, with the record `observed`, the record absent (N=1), a third-base PR and a closed #500. Add a readiness case to `src/conductor/test/engine/shipped-readiness.test.ts`.
2. Verify RED.
3. Implement in `conductor.ts`. `resolveRetainedShipDraftPrUrl`, `readShipDraftReleaseMetadata`, region prepare and capture, and `clearRetainedHaltStateForDispatch` first issue today's exact query (head, base `«default»`, open). Only when it finds no PR, and only when `listExistingChildren` (`child-context.ts`, a filesystem read of `.pipeline/children/`, no git command) reports a child, do they read `activePublicationRecord` and repeat the query with base `retarget.to`. They never accept any other base. `shipped-readiness.ts` is unchanged.
4. Verify GREEN, commit.

**Done when:**
- [test] with #500 retargeted to `feat/c3/demo` and the record `observed`, `resolveRetainedShipDraftPrUrl` and `readShipDraftReleaseMetadata` resolve #500 and read its release-disposition region.
- [test] region prepare, region capture and `clearRetainedHaltStateForDispatch` each resolve #500 with the retargeted base.
- [test] an open PR with head `feat/daemon-demo` and base `release-x` is not adopted and the lookup reports the draft unavailable, and a closed or merged #500 is not adopted.
- [test] for an N=1 feature, both when today's query finds the draft and when it finds none, the lookup's gh argv is exactly today's `pr list --head <leaf> --base main --state open` and its git argv contains no command at all, so no read of `refs/conductor/<slug>/publication` appears.
- [test] `classifyShippedReadiness` for the retargeted leaf with zero checks past the grace period returns `ci-pending`, and the label plan adds nothing.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — two-base lookups
- `src/conductor/test/engine/conductor-retained-draft-retarget.test.ts`, `src/conductor/test/engine/shipped-readiness.test.ts` — tests

**Dependencies:** Task 3

### Task 15: ready_pr flips top-down, by a child-only path for children
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-ready-stack.test.ts`. Record every GitHub write per member, and add crash-injection between flips.
2. Verify RED.
3. Implement in `finish-publication-production.ts`. `readyPr` for a `valid` stack:
   - flips the leaf through `repairPresentation`;
   - then, for each child from the highest position to the lowest, re-reads the stack, checks `checkChildBodyPostconditions`, and calls `ensureShipReady`;
   - skips members already ready;
   - returns `diverged` on a membership or head change;
   - halts naming a child whose postconditions fail.

   The snapshot's `pr.ready` requires every member to be ready.
4. Verify GREEN, commit.

**Done when:**
- [test] `ready_pr` on a verified stack records `pull-request.ready` for #500, then #c3, then #c1, with #500 going through `repairPresentation` and each child through `checkChildBodyPostconditions` and then `ensureShipReady`.
- [test] #c3's ready flip and #c1's ready flip each issue no comment, edit, label or `Closes` write and no title floor, body floor, `Plan:` or accepted-risk projection: for each child, its only GitHub write is `pull-request.ready`.
- [test] interrupted after #500 and #c3 were flipped, the resumed `ready_pr` accepts both as progress, flips only #c1, and does not halt.
- [test] a head SHA or membership change seen by the stack re-read before a flip stops that flip and halts `stack-tip-diverged` naming the member, and a child failing `checkChildBodyPostconditions` stays a draft, is never flipped ready, and the feature halts `needs-human` naming it.
- [test] when every member is ready the snapshot reports `pr.ready` true, and publication proceeds to `record_outcome` with `conduct-state.json` `pr_url` equal to #500.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication-production.ts` — stacked `readyPr`
- `src/conductor/src/engine/finish-publication.ts` — `pr.ready` over members
- `src/conductor/test/engine/finish-publication-ready-stack.test.ts` — tests

**Dependencies:** Task 12, Task 13

### Task 16: Wire stacked publication into the production FINISH dispatch
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing integration test in `src/conductor/test/engine/conductor-finish-stacked.test.ts`. It runs a conductor FINISH dispatch on the three-member real-git fixture, with a fake `gh` and a bare `origin`, through `advanceFinishPublication`.
2. Verify RED.
3. Implement the composition-root wiring in `finish-publication-production.ts` and `conductor.ts`:
   - inject `observeStackDimension` into the observation ports;
   - inject `establishChildPrs`, `assembleStack` and the stacked `readyPr` into the effects;
   - use the per-feature allowance.
4. Verify GREEN, commit.

**Done when:**
- [test] a conductor FINISH dispatch on the three-member fixture runs from `establish_pr` to `record_outcome` through `advanceFinishPublication`, recording the two child pushes and draft PR creates in order, one `pull-request.retarget`, one `stack.create` whose payload is #c1, #c3 and #500 bottom to top, and the top-down ready flips.
- [test] the same run's recorded gh argv contains no `merge`, `merge-async`, auto-merge or ruleset call, nor does the N=1 FINISH golden run's recorded gh argv, and no recorded git argv contains `--force` without an explicit expected SHA.
- [test] the same dispatch with `stacked_prs.enabled: false` and three sealed positions still selects both `establish_child_prs` and `assemble_stack`.
- [test] a dispatch where `establish_pr` succeeds and the first child push then fails reports publication not complete, with `pr.ready` false and the stack dimension not `valid`.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication-production.ts` — composition root
- `src/conductor/src/engine/conductor.ts` — FINISH wiring
- `src/conductor/test/engine/conductor-finish-stacked.test.ts` — integration test

**Dependencies:** Task 10, Task 11, Task 12, Task 13, Task 14, Task 15

### Task 17: Every member runs CI, and a child's default disposition passes release metadata
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/structural/stacked-ci-trigger.test.ts`, which parses the workflow YAML, and in `src/conductor/test/engine/release-metadata-check-action.test.ts`.
2. Verify RED.
3. Implement: in `.github/workflows/ci.yml`, `on.pull_request.branches: [main, 'feat/c*/**']`. Release metadata needs no change. The test locks the existing behavior.
4. Verify GREEN, commit.

**Done when:**
- [test] the structural test asserts `.github/workflows/ci.yml`'s `pull_request` trigger lists branches `main` and `feat/c*/**`, so a PR whose base is `feat/c1/demo` triggers the `ci` workflow and its `ci-gate` job.
- [test] the structural test asserts `release-metadata.yml` and `shipped-record.yml` have no branch filter, and `release-metadata` still skips drafts and runs on `ready_for_review`, so a child is validated at its ready flip.
- [test] `runReleaseMetadataCheckAction` on a child body carrying the template-default `Release-Disposition: no-note` succeeds and applies no `semver:` label.

**Files likely touched:**
- `.github/workflows/ci.yml` — branches filter
- `src/conductor/test/structural/stacked-ci-trigger.test.ts`, `src/conductor/test/engine/release-metadata-check-action.test.ts` — tests

**Dependencies:** none

### Task 18: A child head is never an implementation PR at premerge
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/shipment-association.test.ts` and `src/conductor/test/engine/shipment-evidence-cli.test.ts`, using child, leaf, `feature/x` and missing-head event payloads.
2. Verify RED.
3. Implement:
   - `classifyShipmentAssociation` takes `pr.headRef`, and returns `not-applicable` classification `stack-child` when `parseFeatureBranch(headRef).kind === 'child'`, before path or declaration checks;
   - `readPullRequestEventMetadata` decodes `pull_request.head.ref`;
   - a missing head ref throws a named error, so the check exits non-zero.
4. Verify GREEN, commit.

**Done when:**
- [test] `classifyShipmentAssociation` with head ref `feat/c3/demo` returns `not-applicable` classification `stack-child` before reading body declarations, including for a body carrying `Plan: .docs/plans/demo.md`.
- [test] `shipment-evidence` in premerge mode on a child event reports `shipped-record: not applicable (stack-child)` and exits 0, including when the child body carries `Plan: .docs/plans/demo.md`, and on the leaf event it classifies by the `Plan:` declaration and requires the shipped record as today.
- [test] when the event payload lacks `pull_request.head.ref`, the premerge check exits non-zero with an error naming the missing head ref.
- [test] a PR whose head is `feature/x` is classified exactly as today's shipment-association fixtures expect.

**Files likely touched:**
- `src/conductor/src/engine/shipment-association.ts` — `stack-child` rule
- `src/conductor/src/engine/shipment-evidence-cli.ts` — event decoder head ref
- `src/conductor/test/engine/shipment-association.test.ts`, `src/conductor/test/engine/shipment-evidence-cli.test.ts` — tests

**Dependencies:** none

### Task 19: Reconcile and audit carry the head ref and never repair a child
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/shipment-reconcile-action.test.ts`, `src/conductor/test/engine/shipment-audit.test.ts` and `src/conductor/test/engine/shipment-evidence-cli.test.ts`.
2. Verify RED.
3. Implement:
   - `readPullRequestEvidenceMetadata` requests `headRefName`;
   - the audit GraphQL selects `headRefName`;
   - the reconcile REST adapter keeps `head.ref`;
   - each passes `headRef` to `classifyShipmentAssociation`;
   - a missing head ref yields `unclassified` and no `publishRecordOnlyRepair`.
4. Verify GREEN, commit.

**Done when:**
- [test] the CLI metadata reader, the event decoder, the audit GraphQL query and the reconcile REST adapter each supply the head ref to `classifyShipmentAssociation`, asserted per adapter.
- [test] reconcile and audit on a merged child whose body carries `Plan: .docs/plans/demo.md`, or mentions that path in prose, classify it `stack-child`, open no record-only repair PR, and write no `.docs/shipped/demo.md`.
- [test] reconcile or audit without a readable head ref opens no repair and reports the PR as unclassified.

**Files likely touched:**
- `src/conductor/src/engine/shipment-evidence-cli.ts` — metadata reader
- `src/conductor/src/engine/shipment-audit.ts` — audit query
- `src/conductor/src/engine/shipment-reconcile-action.ts` — reconcile adapter
- `src/conductor/test/engine/shipment-reconcile-action.test.ts`, `src/conductor/test/engine/shipment-audit.test.ts`, `src/conductor/test/engine/shipment-evidence-cli.test.ts` — tests

**Dependencies:** Task 18

### Task 20: The stack-tip-diverged halt class is recorded and never re-kicked
**Story:** 10
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-marker.test.ts`, `src/conductor/test/engine/halt-record.test.ts` and `src/conductor/test/engine/daemon-rekick.test.ts`.
2. Verify RED.
3. Implement:
   - add `stack-tip-diverged` to the `HaltClass` union, the `readHaltClass` allowlist and the operator-action set in `halt-marker.ts`;
   - add it to `isRecordableHaltClass` in `halt-record.ts` and to `RETAINED_HALT_CLASSES` in `daemon-rekick.ts`;
   - add `haltStackTipDiverged(members)` in `stack-publication.ts`, which writes the HALT and emits `stack_tip_diverged`.
4. Verify GREEN, commit.

**Done when:**
- [test] `readHaltClass` accepts `stack-tip-diverged`, `isRecordableHaltClass('stack-tip-diverged')` is true, and the class is in the operator-action set.
- [test] `RETAINED_HALT_CLASSES` contains `stack-tip-diverged`, and a re-kick sweep over a feature halted with it skips the feature and does not re-dispatch it.
- [test] `haltStackTipDiverged` writes a `stack-tip-diverged` HALT whose record names every mismatched member, and emits one `stack_tip_diverged` event naming them.

**Files likely touched:**
- `src/conductor/src/engine/halt-marker.ts` — class union and allowlist
- `src/conductor/src/engine/halt-record.ts` — recordable set
- `src/conductor/src/engine/daemon-rekick.ts` — retained set
- `src/conductor/src/engine/stack-publication.ts` — `haltStackTipDiverged`
- `src/conductor/test/engine/halt-marker.test.ts`, `src/conductor/test/engine/halt-record.test.ts`, `src/conductor/test/engine/daemon-rekick.test.ts` — tests

**Dependencies:** none

### Task 21: The tip guard at executeRemoteGit allows only a verified fast-forward
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-tip-guard.test.ts`, which go through `executeRemoteGit`, with a real-git bare `origin` and server-side rewrites simulated by direct `update-ref` on `origin`. Mock nothing below `executeRemoteGit`'s git runner, and assert the argv.
2. Verify RED.
3. Implement `stack-tip-guard.ts` `guardPublishedStackWrite(slug, destination, source)`. It is called from `executeRemoteGit` for any destination that is a member branch of a slug with an active record, and from the `pull-request.retarget` path:
   1. Recover push intents as `push-lease.ts` does.
   2. Run one `ls-remote` over every member.
   3. Compare each tip with its pushed tip.
   4. Require `merge-base --is-ancestor <recorded> <source>`.

   It returns `allow` or `refuse{members}`. A `tornDown` record is ignored.
4. Verify GREEN, commit.

**Done when:**
- [test] with every member's remote tip equal to its recorded pushed tip, a push to `feat/daemon-demo` that fast-forwards the recorded tip proceeds through `executeRemoteGit` with an explicit expected-SHA lease and records the new tip.
- [test] with a push intent outstanding for `feat/c1/demo` whose new SHA equals the remote, the guard adopts the intent first, then compares the tips, and does not refuse.
- [test] with every tip matching, a push whose source does not contain the recorded tip is refused and the remote branch is unchanged.
- [test] with #c3 and #500 rewritten on `origin`, a FINISH publication push or `pull-request.retarget` is refused, the feature halts `stack-tip-diverged` naming positions 3 and 5, and `stack_tip_diverged` is emitted.
- [test] the guard runs only on writes: a sweep read of the stack after the operator merges the remaining members writes no HALT, and a `tornDown` record never causes a refusal.

**Files likely touched:**
- `src/conductor/src/engine/stack-tip-guard.ts` — new guard
- `src/conductor/src/engine/remote-git-operations.ts` — guard call
- `src/conductor/test/engine/stack-tip-guard.test.ts` — tests

**Dependencies:** Task 3, Task 20

### Task 22: Each caller maps a guard refusal, and agents cannot publish children
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - `src/conductor/test/engine/halt-record.test.ts`: the push skip;
   - `src/conductor/test/engine/post-finish-shipped-record.test.ts`;
   - `src/conductor/test/engine/github-operations-cli.test.ts`: the mismatch refusal, and the refusal of an unrecorded child push or bind.

   Mock the gh runner boundary and assert refused calls never reach it.
2. Verify RED.
3. Implement:
   - `halt-record.ts` maps a guard refusal to `halt_record_push_failed` with reason `stack-tip-mismatch`, keeping the ahead-of-remote note;
   - `post-finish-shipped-record.ts` logs a skip;
   - `github-operations-cli.ts` refuses a mismatch with a stack-tip reason, and refuses a push of, or a PR bind to, a `feat/c<p>/<slug>` the record does not list.
4. Verify GREEN, commit.

**Done when:**
- [test] with the tips mismatched, the halt-record push is skipped, `halt_record_push_failed` is emitted with reason `stack-tip-mismatch`, the record keeps its may-be-ahead-of-the-remote note, and no further HALT is written.
- [test] with the tips mismatched, `refreshPostFinishShippedRecord` skips its push, logs the skip, and keeps the local commit.
- [test] with the tips mismatched, an agent push to `feat/daemon-demo` through `conduct github-operation` is refused with a reason naming the stack tip mismatch.
- [test] with the record not listing position 3, `conduct github-operation` refuses a push of `feat/c3/demo` and a PR bind to it, and the gh runner is never called.

**Files likely touched:**
- `src/conductor/src/engine/halt-record.ts` — refusal mapping
- `src/conductor/src/engine/post-finish-shipped-record.ts` — skip
- `src/conductor/src/engine/github-operations-cli.ts` — refusals
- `src/conductor/test/engine/halt-record.test.ts`, `src/conductor/test/engine/post-finish-shipped-record.test.ts`, `src/conductor/test/engine/github-operations-cli.test.ts` — tests

**Dependencies:** Task 21

### Task 23: Every restack producer and route admission refuses a published stack
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - `src/conductor/test/engine/conductor-finish-rebase-published.test.ts`;
   - `src/conductor/test/engine/daemon-rekick-published.test.ts`;
   - `src/conductor/test/engine/restack/stack-preflight-published.test.ts`;
   - `src/conductor/test/engine/routing/round-admission-published.test.ts`.
2. Verify RED.
3. Implement `publishedStackRefusal(slug)` in `stack-publication.ts`, which uses `activePublicationRecord`. Call it:
   - in the FINISH `rebase` step and the re-kick base refresh: emit `restack_refused` `published-stack`, move nothing, and continue;
   - in the stack preflight's `feature-repair` restack and the routed-exit restack: refuse and halt `needs-human` naming the child;
   - in route admission: refuse before any `routes/` ref is written.
4. Verify GREEN, commit.

**Done when:**
- [test] with the record holding members, the FINISH `rebase` step and the re-kick base refresh each emit `restack_refused` reason `published-stack`, move no ref, and continue: FINISH selects its next step and re-kick retries its gate on the current base.
- [test] with a commit past child 1's closure, the stack preflight's `feature-repair` restack and the routed-exit restack refuse with `published-stack`, move no ref, and the feature halts `needs-human` naming position 1.
- [test] with the record holding members, route admission refuses a new round naming `published-stack` and creates no `refs/conductor/demo/routes/` ref.
- [test] with a `tornDown` record, none of these refusals fires, and the restack and route admission run as today.

**Files likely touched:**
- `src/conductor/src/engine/stack-publication.ts` — `publishedStackRefusal`
- `src/conductor/src/engine/conductor.ts` — FINISH rebase
- `src/conductor/src/engine/daemon-rekick.ts` — base refresh
- `src/conductor/src/engine/restack/stack-preflight.ts` — repair restack
- `src/conductor/src/engine/routing/round-admission.ts` — admission
- `src/conductor/test/engine/conductor-finish-rebase-published.test.ts`, `src/conductor/test/engine/daemon-rekick-published.test.ts`, `src/conductor/test/engine/restack/stack-preflight-published.test.ts`, `src/conductor/test/engine/routing/round-admission-published.test.ts` — tests

**Dependencies:** Task 3

### Task 24: ci-fix is ineligible for a stacked feature's leaf
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/ci-fix-published-stack.test.ts`.
2. Verify RED.
3. Implement: the ci-fix candidate check in `ci-fix.ts` (and its sweep caller in `mergeable-sweep.ts`) consults `activePublicationRecord`. When the record has members, the entry escalates through the same `published-stack` path autoresolve uses (`autoresolve.ts`), and nothing is dispatched.
4. Verify GREEN, commit.

**Done when:**
- [test] with the record holding members and #500's checks failed, the sweep's ci-fix eligibility returns ineligible and escalates through autoresolve's `published-stack` path, and no ci-fix dispatch is recorded.
- [test] an N=1 PR with failed checks is still collected as a ci-fix candidate exactly as today's ci-fix fixtures expect.

**Files likely touched:**
- `src/conductor/src/engine/ci-fix.ts` — eligibility
- `src/conductor/src/engine/mergeable-sweep.ts` — candidate collection
- `src/conductor/test/engine/ci-fix-published-stack.test.ts` — tests

**Dependencies:** Task 3

### Task 25: Only the leaf merging ships, and every member is proven on main
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/mergeable-sweep-stack-ship.test.ts`, with a real-git `origin`, squash commits per member, and a fake `gh`. Add a backlog dedup case to `src/conductor/test/engine/daemon-backlog.test.ts`.
2. Verify RED.
3. Implement in `mergeable-sweep.ts`. After the unchanged shipped-record gate passes for a stacked entry:
   1. remove the worktree;
   2. run `verifyMemberReachability(record)`: each member is merged, and its `merge_commit_sha` passes `merge-base --is-ancestor <sha> origin/main`.

   A lower-prefix merge never passes the gate.
4. Verify GREEN, commit.

**Done when:**
- [test] with the stack merged in one go, the sweep sees #500 merged and `.docs/shipped/demo.md` on `origin/main`, `verifyMemberReachability` finds #c1, #c3 and #500 merged with their squash commits ancestors of `origin/main`, and exactly one shipped record exists for `demo`.
- [test] after the leaf merged, `daemon-backlog` dedups `demo` as shipped and never re-dispatches it.
- [test] with only #c1 merged, the sweep finds no shipped record on `main`, makes no teardown call, keeps the worktree and every branch, deletes no ref, retains the watch entry, and records no intake close call.

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — stacked reap path
- `src/conductor/src/engine/stack-publication.ts` — `verifyMemberReachability`
- `src/conductor/test/engine/mergeable-sweep-stack-ship.test.ts`, `src/conductor/test/engine/daemon-backlog.test.ts` — tests

**Dependencies:** Task 3

### Task 26: Unreachable, unreadable and dissolved stacks are reported and kept
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/mergeable-sweep-stack-ship.test.ts`. The fixtures are an unreachable member, a failing member read, and a leaf merged into a child branch.
2. Verify RED.
3. Implement:
   - emit `stack_members_unreachable` once, then CAS-write `unreachableReported` and `tornDown`, and keep that member's branch;
   - on an indeterminate read, retain the entry and delete nothing;
   - for a dissolved stack, the leaf merged into a child branch never satisfies the gate.
4. Verify GREEN, commit.

**Done when:**
- [test] with #c3's squash commit not an ancestor of `origin/main`, `stack_members_unreachable` names #c3 exactly once across two sweeps, the record is marked `unreachableReported` and `tornDown`, and `feat/c3/demo` survives.
- [test] a failing member-state read during reachability removes the worktree in that pass, retains the watch entry, and deletes no child branch or conductor ref.
- [test] with #500 merged into `feat/c3/demo` after the stack was dissolved, no shipped record exists on `origin/main`, and no teardown call is made.

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — retention paths
- `src/conductor/src/engine/stack-publication.ts` — report receipt
- `src/conductor/test/engine/mergeable-sweep-stack-ship.test.ts` — tests

**Dependencies:** Task 2, Task 25

### Task 27: Non-leaf member lifecycle is reported at least once and changes nothing
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/mergeable-sweep-stack-lifecycle.test.ts`. The fixtures are a merged #c1, a closed #c3, a revert PR, a crash between emit and CAS, an unchanged state, and an N=1 entry.
2. Verify RED.
3. Implement in `mergeable-sweep.ts`. For a stacked entry whose leaf is open:
   1. run one `stack.read`, then each member's state;
   2. for merged members, search for a merged PR carrying `Reverts <repo>#<n>`;
   3. on a new state, emit `stack_member_lifecycle` with a deterministic `eventId` (`<slug>:<position>:<state>`), then CAS-write `lastSeen`.

   An N=1 entry makes no stack read.
4. Verify GREEN, commit.

**Done when:**
- [test] with #500 open and #c1 merged, a sweep emits one `stack_member_lifecycle` with `child` 1, PR #c1, state `merged` and a deterministic `eventId`, then CAS-writes `lastSeen` `merged` for position 1.
- [test] #c3 closed unmerged yields one event with state `closed` for position 3, and #c1 merged with a later merged PR on `main` carrying `Reverts jstoup111/ai-conductor#c1` yields one event with state `reverted` for position 1.
- [test] a crash after emitting the `merged` event and before the `lastSeen` write re-emits it with the same `eventId` on the next sweep and the persisted ledger holds it once, and a member whose state is unchanged emits nothing.
- [test] after any lifecycle event the feature's shipped record, intake issue state, worktree, child branches, conductor refs and the record's `tornDown` mark are unchanged, and an N=1 entry's sweep records no stack read and no `stack_*` event.

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — lifecycle observation
- `src/conductor/test/engine/mergeable-sweep-stack-lifecycle.test.ts` — tests

**Dependencies:** Task 2, Task 3

### Task 28: Teardown deletes child branches by name under the stack-member proof
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-teardown.test.ts` and `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts`, with a real-git fixture. Record the deletion argv, and inject a delete failure.
2. Verify RED.
3. Implement `stack-teardown.ts` `deleteStackChildren(slug, record)`:
   1. take the sealed child positions from the positions ref;
   2. for each, check the member is reachable and the local tip equals its merged `headRefOid`;
   3. `update-ref -d refs/heads/feat/c<p>/<slug> <tip>`;
   4. stop at the first failure.

   Wire it into the sweep reap after Task 26's reachability check. When every child is deleted, delete `refs/conductor/<slug>/positions` and `refs/conductor/<slug>/publication` by explicit name, last, in this path only. They stay out of the shared `featureConductorRefNames` list that park reconciliation uses. Any kept member marks the record `tornDown`.
4. Verify GREEN, commit.

**Done when:**
- [test] with #500 merged, the record on `main`, every member reachable and each local child tip equal to its merged PR's `headRefOid`, the reap removes the worktree, deletes `feat/c1/demo` and `feat/c3/demo` by name with those tips as compare-and-swap expected values, then deletes the conductor refs, including `positions` and `publication`, in that order.
- [test] a local `feat/c1/demo` with a commit past #c1's merged head is kept and the record is kept marked `tornDown`, and an unreachable #c3 keeps `feat/c3/demo` and marks the record `tornDown` while `feat/c1/demo` is deleted.
- [test] a failed delete of `feat/c1/demo` stops the remaining deletes and retains the watch entry so the next sweep retries, and `feat/c7/demo`, which is not a sealed position, is never deleted.
- [test] `deleteStackChildren`'s all-deleted path deletes `refs/conductor/demo/positions` and `refs/conductor/demo/publication` by name, and `featureConductorRefNames('demo')` includes neither.

**Files likely touched:**
- `src/conductor/src/engine/stack-teardown.ts` — child deletion
- `src/conductor/src/engine/mergeable-sweep.ts` — reap wiring
- `src/conductor/src/engine/restack/restack-refs-cleanup.ts` — unchanged shared list, asserted
- `src/conductor/test/engine/stack-teardown.test.ts`, `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts` — tests

**Dependencies:** Task 26

### Task 29: Reclaim deletes children only after the leaf ships, and park never does
**Story:** 11
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-park-cli-reclaim-stack.test.ts` and `src/conductor/test/engine/park-reconciliation.test.ts`.
2. Verify RED.
3. Implement: `reclaim-worktree` in `daemon-park-cli.ts` calls `deleteStackChildren` only when `shippedRecordOnMain` is `present` and reachability passes. Otherwise it removes the worktree as today and CAS-marks the record `tornDown`. Park reconciliation (`reconcileMergedPark` in `park-reconciliation.ts`) still deletes no child branch. It now CAS-marks any active record `tornDown` when it reclaims a stacked slug.
4. Verify GREEN, commit.

**Done when:**
- [test] `reclaim-worktree demo` with the shipped-record gate and reachability passing deletes `feat/c1/demo`, `feat/c3/demo` and the conductor refs by name, exactly as the sweep reap does.
- [test] `reclaim-worktree demo` with #500 closed unmerged removes the worktree as today, keeps `feat/c1/demo` and `feat/c3/demo`, and marks the record `tornDown`.
- [test] park reconciliation of a parked `demo` deletes no child branch, as today, and `reconcileMergedPark` on a merged stacked `demo` with kept children deletes neither `refs/conductor/demo/positions` nor `refs/conductor/demo/publication` and marks the record `tornDown`.

**Files likely touched:**
- `src/conductor/src/engine/daemon-park-cli.ts` — reclaim
- `src/conductor/src/engine/park-reconciliation.ts` — mark the record torn down
- `src/conductor/test/engine/daemon-park-cli-reclaim-stack.test.ts`, `src/conductor/test/engine/park-reconciliation.test.ts` — tests

**Dependencies:** Task 28

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-R1: finish-publication-production.ts/ship-draft-pr.ts: build a per-operation GithubMutationExecutionContext whose provenance.target matches each stacked write (child remote-ref push, child PR create, leaf pull-request draft/retarget/ready, repository/stack-number stack.read/create/add, child ready), so mutation-policy authorizes each stacked write against its own target
**Gate:** prd-audit
**Rationale:** ADR decisions 5/11/13 already approve child pushes and stack operations with their own targets. The defect is production wiring: one runner bound to the leaf remote-ref provenance target (ship-draft-pr.ts:264-276) is reused for every child destination, and mutation-policy refuses it as invalid-target. This is conforming implementation work, and the missing three-member dispatch test is part of Task 16.
**Criterion:** S2.1
**Parent task:** 16
**Done when:**
- [test] S2.1 is satisfied by this task.
- The repair for task rem-prd-audit-R1 is committed and its targeted tests pass.

### Task rem-prd-audit-R3: Add a conductor FINISH dispatch test on the three-member fixture that runs establish_pr→record_outcome through advanceFinishPublication with the real mutation-policy runner (no unbound context), covering the Task 16 done-when argv assertions
**Gate:** prd-audit
**Rationale:** ADR decisions 5/11/13 already approve child pushes and stack operations with their own targets. The defect is production wiring: one runner bound to the leaf remote-ref provenance target (ship-draft-pr.ts:264-276) is reused for every child destination, and mutation-policy refuses it as invalid-target. This is conforming implementation work, and the missing three-member dispatch test is part of Task 16.
**Criterion:** S2.1
**Parent task:** 16
**Done when:**
- [test] S2.1 is satisfied by this task.
- The repair for task rem-prd-audit-R3 is committed and its targeted tests pass.

### Task rem-prd-audit-R1-2: finish-publication-production.ts/ship-draft-pr.ts: per-operation mutation contexts whose provenance.target matches each stacked write
**Gate:** prd-audit
**Rationale:** The child push logic is already correct. Only the production remoteMutation target binding refuses the child ref, so the shared per-target context fix applies.
**Criterion:** S2.2
**Parent task:** 16
**Done when:**
- [test] S2.2 is satisfied by this task.
- The repair for task rem-prd-audit-R1-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R3-2: Three-member conductor FINISH dispatch test with the real mutation-policy runner
**Gate:** prd-audit
**Rationale:** The child push logic is already correct. Only the production remoteMutation target binding refuses the child ref, so the shared per-target context fix applies.
**Criterion:** S2.2
**Parent task:** 16
**Done when:**
- [test] S2.2 is satisfied by this task.
- The repair for task rem-prd-audit-R3-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R4: Test that a ready leaf #500 is re-drafted through pull-request.draft under a leaf pull-request-target context before the first child push, emitting stack_member_redrafted at the sealed leaf position
**Gate:** prd-audit
**Rationale:** The leaf re-draft runs through a runner bound to the remote-ref target and is refused. It needs a pull-request-target context and a test, both within Task 10.
**Criterion:** S2.4
**Parent task:** 10
**Done when:**
- [test] S2.4 is satisfied by this task.
- The repair for task rem-prd-audit-R4 is committed and its targeted tests pass.

### Task rem-prd-audit-R5: finish-publication-production.ts establishChildPrs: feed renderChildBody the sealed position's slice name, task ids, story ids/stories and diffstat, and final child PR references, and title each child PR from the sealed slice rather than 'Stack slice N'; add a production-path test
**Gate:** prd-audit
**Rationale:** renderChildBody already supports real content, but production feeds it placeholders. Task 10/ADR D6 require sealed slice evidence, so this is a conforming implementation fix.
**Criterion:** S3.1
**Parent task:** 10
**Done when:**
- [test] S3.1 is satisfied by this task.
- The repair for task rem-prd-audit-R5 is committed and its targeted tests pass.

### Task rem-prd-audit-R6: finish-publication-production.ts assembleStack: after final membership, re-render ## Stack on every child (checkChildBodyPostconditions before pull-request.edit; failure halts needs-human naming the member) and add/refresh ## Stack on the leaf while preserving captured project-owned regions byte-identically; never read the capture store for child URLs; add the Task 13 tests
**Gate:** prd-audit
**Rationale:** The leaf ## Stack section is specified by Task 13 and ADR D6 but was never implemented in production.
**Criterion:** S3.2
**Parent task:** 13
**Done when:**
- [test] S3.2 is satisfied by this task.
- The repair for task rem-prd-audit-R6 is committed and its targeted tests pass.

### Task rem-prd-audit-R6-2: assembleStack re-renders ## Stack on every member after final membership, with child postconditions and leaf region preservation; add the Task 13 tests
**Gate:** prd-audit
**Rationale:** The post-assembly navigation re-render is missing. It is the same Task 13 work as S3.2.
**Criterion:** S3.3
**Parent task:** 13
**Done when:**
- [test] S3.3 is satisfied by this task.
- The repair for task rem-prd-audit-R6-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R7: assembleStack + stack-publication.ts observer: discover by member 1, refuse (diverged, no create/add) when a member is in another stack or the existing stack is not an ordered prefix of the record, then stack.create/stack.add; re-read and compare ordered membership, bases and each member head SHA against the recorded pushed tip before marking verified; the observer re-verifies membership, bases and heads rather than trusting the stored flag or any parseable JSON; add the Task 12 tests
**Gate:** prd-audit
**Rationale:** Head-SHA verification against pushed tips is required by Task 12/ADR D5 and is missing.
**Criterion:** S4.2
**Parent task:** 12
**Done when:**
- [test] S4.2 is satisfied by this task.
- The repair for task rem-prd-audit-R7 is committed and its targeted tests pass.

### Task rem-prd-audit-R7-2: assembleStack/observer: member-1 discovery, prefix/other-stack checks before writes, and head-SHA and base verification; Task 12 tests
**Gate:** prd-audit
**Rationale:** Discovery must key on member 1 according to ADR D5 step 2. This is an implementation miss.
**Criterion:** S4.3
**Parent task:** 12
**Done when:**
- [test] S4.3 is satisfied by this task.
- The repair for task rem-prd-audit-R7-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R8: finish-publication.ts nextFinishPublicationTransition: an observed 'diverged' stack dimension halts stack-tip-diverged (via haltStackTipDiverged naming positions, emitting stack_tip_diverged through a real emitter) instead of selecting assemble_stack; typed retarget/assembly divergence in finish-publication-production.ts halts instead of throwing generic retryable errors
**Gate:** prd-audit
**Rationale:** The other-stack and missing-middle checks, and routing an observed diverged state to a halt instead of assembly, are specified by Tasks 12/20.
**Criterion:** S4.6
**Parent task:** 12
**Done when:**
- [test] S4.6 is satisfied by this task.
- The repair for task rem-prd-audit-R8 is committed and its targeted tests pass.

### Task rem-prd-audit-R7-3: assembleStack/observer: head-SHA verification before marking verified; Task 12 tests
**Gate:** prd-audit
**Rationale:** This is the same missing head-SHA verification as S4.2.
**Criterion:** S4.7
**Parent task:** 12
**Done when:**
- [test] S4.7 is satisfied by this task.
- The repair for task rem-prd-audit-R7-3 is committed and its targeted tests pass.

### Task rem-prd-audit-R9: finish-publication-production.ts ready_pr: flip the leaf first via repairPresentation, then children top-down (#c3, #c1), each via checkChildBodyPostconditions then ensureShipReady using a child pull-request-target context; before each flip, parse the stack.read response and halt stack-tip-diverged naming the member when membership or head SHA differs from the record; snapshot pr.ready is true only when every member is ready; add the Task 15 tests
**Gate:** prd-audit
**Rationale:** The ready order is inverted, the child path is wrong, and child ready is refused by the leaf-bound runner. Task 15 specifies the correct behavior.
**Criterion:** S6.1
**Parent task:** 15
**Done when:**
- [test] S6.1 is satisfied by this task.
- The repair for task rem-prd-audit-R9 is committed and its targeted tests pass.

### Task rem-prd-audit-R1-3: Per-operation mutation contexts whose provenance.target matches each stacked write
**Gate:** prd-audit
**Rationale:** The ready order is inverted, the child path is wrong, and child ready is refused by the leaf-bound runner. Task 15 specifies the correct behavior.
**Criterion:** S6.1
**Parent task:** 15
**Done when:**
- [test] S6.1 is satisfied by this task.
- The repair for task rem-prd-audit-R1-3 is committed and its targeted tests pass.

### Task rem-prd-audit-R9-2: ready_pr top-down with child-only path, per-flip membership/head verification, and all-member snapshot readiness; Task 15 tests
**Gate:** prd-audit
**Rationale:** Snapshot readiness looks only at the leaf. Task 15 requires all-member readiness.
**Criterion:** S6.4
**Parent task:** 15
**Done when:**
- [test] S6.4 is satisfied by this task.
- The repair for task rem-prd-audit-R9-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R9-3: ready_pr per-flip stack.read membership/head verification; Task 15 tests
**Gate:** prd-audit
**Rationale:** The per-flip stack read response is discarded. Task 15 requires membership and head verification.
**Criterion:** S6.5
**Parent task:** 15
**Done when:**
- [test] S6.5 is satisfied by this task.
- The repair for task rem-prd-audit-R9-3 is committed and its targeted tests pass.

### Task rem-prd-audit-R10: stack-tip-guard.ts/remote-git-operations.ts/tracker-client.ts: run the tip guard on pull-request.retarget too; return mismatched members as positions (not PR numbers) in the refusal; adopt outstanding push intents before comparing tips on child-push retries (stack-publication.ts); gate the guard and readyStackChildren on child state so N=1 issues no publication-ref read; run restack stack-preflight's freeze before recovery and guard restack-recovery's follow-on restack; add the Task 21 tests including an N=1 git-argv parity assertion
**Gate:** prd-audit
**Rationale:** ADR D11 requires the tip guard on retarget as well as pushes, and requires HALTs to name positions. This is an implementation gap.
**Criterion:** S10.6
**Parent task:** 21
**Done when:**
- [test] S10.6 is satisfied by this task.
- The repair for task rem-prd-audit-R10 is committed and its targeted tests pass.

### Task rem-prd-audit-R11: remote-git-operations.ts: return a typed stack-tip-mismatch refusal without writing a HALT; FINISH publication callers map it to haltStackTipDiverged; halt-record.ts skips the push, emits halt_record_push_failed reason stack-tip-mismatch and writes no HALT; refreshPostFinishShippedRecord skips and logs; add the Task 22 tests with the real executeRemoteGit refusal path
**Gate:** prd-audit
**Rationale:** executeRemoteGit writes a HALT for every refusal. ADR D11/Task 22 require each caller to map the refusal itself, and the halt-record push must never write another HALT.
**Criterion:** S10.9
**Parent task:** 22
**Done when:**
- [test] S10.9 is satisfied by this task.
- The repair for task rem-prd-audit-R11 is committed and its targeted tests pass.

### Task rem-prd-audit-R12: daemon-park-cli.ts reclaim-worktree: read the active publication record; with the shipped-record gate and reachability passing, call deleteStackChildren exactly as the sweep reap does; on a closed-unmerged leaf, keep the children and mark the record tornDown; park-reconciliation.ts reconcileMergedPark keeps the positions/publication refs and marks tornDown when children are kept; add the Task 29 tests
**Gate:** prd-audit
**Rationale:** Reclaim-worktree stack cleanup is specified by Task 29 and was never wired.
**Criterion:** S11.2
**Parent task:** 29
**Done when:**
- [test] S11.2 is satisfied by this task.
- The repair for task rem-prd-audit-R12 is committed and its targeted tests pass.

### Task rem-prd-audit-R12-2: reclaim-worktree/park reconciliation stack handling and tornDown marking; Task 29 tests
**Gate:** prd-audit
**Rationale:** This is the same missing Task 29 reclaim wiring as S11.2.
**Criterion:** S11.3
**Parent task:** 29
**Done when:**
- [test] S11.3 is satisfied by this task.
- The repair for task rem-prd-audit-R12-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R13: mergeable-sweep.ts/stack-teardown.ts: retain the watch entry exactly once per sweep (no pre-reachability push, no duplicate after the kept write, drop it after a full successful delete, retain it on a caught teardown failure); delete reachable children per member with only unreachable/advanced ones kept; treat an already-deleted branch as deleted, and a git probe error as a stop-and-retry failure rather than kept; tornDown must not block retry of incomplete cleanup; add the Task 28 tests
**Gate:** prd-audit
**Rationale:** The sweep's watch-entry bookkeeping duplicates entries. This is a Task 28 implementation defect.
**Criterion:** S11.4
**Parent task:** 28
**Done when:**
- [test] S11.4 is satisfied by this task.
- The repair for task rem-prd-audit-R13 is committed and its targeted tests pass.

### Task rem-prd-audit-R14: finish-publication-production.ts establishChildPrs: use a torn-down prior record only for its CAS receipt and start new membership empty (no position-mismatch halt, no merging of stale members, no duplicate leaf append); add a republish-after-teardown test
**Gate:** prd-audit
**Rationale:** A torn-down prior record must supply only the CAS receipt (ADR D2). Reusing its membership is an implementation bug in Task 10.
**Criterion:** S11.5
**Parent task:** 10
**Done when:**
- [test] S11.5 is satisfied by this task.
- The repair for task rem-prd-audit-R14 is committed and its targeted tests pass.

### Task rem-prd-audit-R13-2: mergeable-sweep.ts/stack-teardown.ts: per-member deletion with unreachable members kept, resumable failure handling and single watch-entry retention; Task 28 tests
**Gate:** prd-audit
**Rationale:** Per-member retention under unreachability is specified by Task 28.
**Criterion:** S11.6
**Parent task:** 28
**Done when:**
- [test] S11.6 is satisfied by this task.
- The repair for task rem-prd-audit-R13-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R15: github-operations.ts: allow a stack-number target for stack.read; github-operations-cli.ts: refuse a child push or PR bind when the publication record is missing, unreadable or torn-down, not only when an active record omits the position; add the Task 7/22 tests under bound (non-unbound) mutation contexts
**Gate:** prd-audit
**Rationale:** ADR D13 approves the stack.read/stack.add targets. Production refuses them only because the contexts are bound to the leaf target, and github-operations.ts lacks the known-stack-number stack.read target.
**Criterion:** S12.2
**Parent task:** 7
**Done when:**
- [test] S12.2 is satisfied by this task.
- The repair for task rem-prd-audit-R15 is committed and its targeted tests pass.

### Task rem-as-built-R2: finish-publication-production.ts:223 Git adapter: forward options.input as stdin (and return exit code/stdout) so stack-publication-record hash-object persists the record; add a production-adapter record-write test
**Gate:** as-built
**Rationale:** The Git adapter drops stdin input needed by hash-object. This is a clear implementation defect in Task 10's production wiring.
**Parent task:** 10
**Governing clause:** Task 10
**Done when:**
- Task 10 is satisfied by this task.
- The repair for task rem-as-built-R2 is committed and its targeted tests pass.

### Task rem-prd-audit-R10-2: Tip-guard coverage/gating, including the N=1 no-publication-ref-read gate in remote-git-operations and readyStackChildren and an N=1 golden argv parity test
**Gate:** prd-audit
**Rationale:** N=1 argv parity (ADR D1) is broken by unconditional publication-ref reads. The guard and readiness need a child-state gate.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 1
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 1 is satisfied by this task.
- The repair for task rem-prd-audit-R10-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R14-2: establishChildPrs: a torn-down prior record supplies the CAS receipt only, with fresh membership; republish test
**Gate:** prd-audit
**Rationale:** A torn-down record must supply the CAS receipt only (ADR D2).
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 2
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 2 is satisfied by this task.
- The repair for task rem-prd-audit-R14-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R7-4: stack-publication.ts observer re-verifies ordered membership, bases and head SHAs rather than trusting the stored flag or any parseable JSON; Task 12 tests
**Gate:** prd-audit
**Rationale:** The observer must verify bases, heads and current membership (ADR D5).
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5 is satisfied by this task.
- The repair for task rem-prd-audit-R7-4 is committed and its targeted tests pass.

### Task rem-prd-audit-R5-2: establishChildPrs renders child bodies/titles from sealed slice evidence and final PR references
**Gate:** prd-audit
**Rationale:** Placeholder bodies and the missing navigation refresh violate ADR D6. Both are implementation work.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 6
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 6 is satisfied by this task.
- The repair for task rem-prd-audit-R5-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R6-3: assembleStack re-renders ## Stack on every member, including the leaf, with region preservation; Task 13 tests
**Gate:** prd-audit
**Rationale:** Placeholder bodies and the missing navigation refresh violate ADR D6. Both are implementation work.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 6
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 6 is satisfied by this task.
- The repair for task rem-prd-audit-R6-3 is committed and its targeted tests pass.

### Task rem-prd-audit-R9-4: ready_pr leaf-first top-down with child-only path, per-flip membership/head verification and all-member snapshot readiness; Task 15 tests
**Gate:** prd-audit
**Rationale:** Ready order, per-flip verification and snapshot readiness must follow ADR D7/Task 15.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 7
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 7 is satisfied by this task.
- The repair for task rem-prd-audit-R9-4 is committed and its targeted tests pass.

### Task rem-prd-audit-R8-2: Route observed/typed divergence to haltStackTipDiverged with a real event emitter instead of assemble_stack or generic retry; tests
**Gate:** prd-audit
**Rationale:** Diverged must halt with stack_tip_diverged emission instead of routing to assembly or retry (Task 20).
**Parent task:** 20
**Governing clause:** Task 20
**Done when:**
- Task 20 is satisfied by this task.
- The repair for task rem-prd-audit-R8-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R10-3: Tip guard on retarget, intent adoption before tip compare, restack preflight freeze-before-recovery and a guarded follow-on restack; Task 21/23 tests
**Gate:** prd-audit
**Rationale:** ADR D11 guard coverage is missing on retarget, the intent-recovery order and restack preflight.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11 is satisfied by this task.
- The repair for task rem-prd-audit-R10-3 is committed and its targeted tests pass.

### Task rem-prd-audit-R11-2: executeRemoteGit returns a typed refusal without writing a HALT; callers map it (FINISH halts; halt-record and post-finish skip); Task 22 tests
**Gate:** prd-audit
**Rationale:** Refusal handling must be caller-mapped. The halt-record path must not re-HALT (ADR D11/Task 22).
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 11 is satisfied by this task.
- The repair for task rem-prd-audit-R11-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R15-2: github-operations-cli refuses child writes when the record is missing/unreadable/torn-down; github-operations allows a stack-number stack.read target; tests
**Gate:** prd-audit
**Rationale:** ADR D13 restricts child publication when the record is absent or unusable and approves a stack-number stack.read target.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 13
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 13 is satisfied by this task.
- The repair for task rem-prd-audit-R15-2 is committed and its targeted tests pass.

### Task rem-as-built-R16: shipment-audit.ts: exclude child-head candidates before classification so a child mention never returns plan-level absent or ambiguity ahead of a legitimate leaf candidate; add a test where a child mentions the plan and the leaf shipped
**Gate:** as-built
**Rationale:** Shipment-audit child exclusion order is a Task 19 implementation defect under ADR D8.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 8
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 8 is satisfied by this task.
- The repair for task rem-as-built-R16 is committed and its targeted tests pass.

### Task rem-as-built-R17: stack-publication.ts member-state parsing: reject malformed objects and missing/unknown state as indeterminate (not unreachable); mergeable-sweep.ts retries indeterminate evidence on later sweeps without recording tornDown; tests
**Gate:** as-built
**Rationale:** Malformed member state must be indeterminate and retried, not terminal (ADR D9/Task 26).
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 9
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 9 is satisfied by this task.
- The repair for task rem-as-built-R17 is committed and its targeted tests pass.

### Task rem-as-built-R18: mergeable-sweep.ts revert detection: restrict the search to merged PRs whose base is the default branch, fetch their bodies, and require GitHub's 'Reverts <repo>#<n>' line before reporting reverted; tests for an unrelated mention and a merge into a child branch
**Gate:** as-built
**Rationale:** Revert detection must verify a merged default-branch PR carrying the revert line (ADR D10/Task 27).
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 10
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 10 is satisfied by this task.
- The repair for task rem-as-built-R18 is committed and its targeted tests pass.

### Task rem-prd-audit-R13-3: mergeable-sweep.ts/stack-teardown.ts: per-member deletion, resumable failure handling and single watch-entry retention; Task 28 tests
**Gate:** prd-audit
**Rationale:** Per-member retention and resumable teardown are specified by ADR D12/Task 28.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 12
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 12 is satisfied by this task.
- The repair for task rem-prd-audit-R13-3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-n1-guard-gate: stack-tip-guard.ts/remote-git-operations.ts: gate guardPublishedStackPushes on durable child state so an N=1 leaf push issues no publication-ref rev-parse; add an N=1 golden test whose FINISH fixture actually pushes the leaf and asserts git argv parity
**Gate:** prd-audit
**Rationale:** Verified: stack-tip-guard.ts:75 calls activePublicationRecord before any child-state gate, and remote-git-operations.ts:315 enters the guard on every push. ADR decision 1 is clear, so this is conforming implementation drift.
**Criterion:** S1.4
**Parent task:** rem-prd-audit-R10-2
**Done when:**
- [test] S1.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-n1-guard-gate is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-rerender-template: finish-publication-production.ts assembleStack re-render: pass deps.prTemplateBytes to checkChildBodyPostconditions, mask opaque/captured regions in replaceStackNavigation, rewrite the leaf through the established captured-region rewrite, emit stack_assembled; add Task 13 tests using a template with ai-conductor:step regions
**Gate:** prd-audit
**Rationale:** Verified: finish-publication-production.ts:775 passes undefined as the template to checkChildBodyPostconditions, so a child carrying template regions fails and the re-render halts. The fix is a code change under the approved Task 13 design.
**Criterion:** S3.1
**Parent task:** rem-prd-audit-R6-2
**Done when:**
- [test] S3.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-rerender-template is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-foreign-stack: finish-publication-production.ts assembleStack: before stack.create/stack.add, read stack membership for every record member and halt stack-tip-diverged naming the position when any member belongs to a foreign stack; test #c3 in a different stack with no create/add in argv
**Gate:** prd-audit
**Rationale:** Discovery checks only member 1, so foreign-stack membership of a later member goes undetected. ADR decision 5 already requires refusing before create/add; this is implementation work.
**Criterion:** S4.6
**Parent task:** rem-prd-audit-R8
**Done when:**
- [test] S4.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-foreign-stack is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-read-indeterminate: finish-publication-production.ts executeValidatedStackOperation: distinguish transport failure/timeout of stack.read from authorization refusal and surface it as indeterminate so advanceFinishPublication returns publication_retry; test timed-out stack.read records no pull-request.ready
**Gate:** prd-audit
**Rationale:** executeValidatedStackOperation maps a failed (timed-out) read to a precondition halt. Task 12 requires indeterminate retry routing, so this is clear implementation drift.
**Criterion:** S4.8
**Parent task:** 12
**Done when:**
- [test] S4.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-read-indeterminate is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-ready-target-binding: finish-publication-production.ts verifyStackBeforeReadyFlip/readyStackChildren/repairPresentation: obtain repository- or per-PR-bound operations via operationsForTarget for stack.read and each child pull-request.ready; add production-wiring tests using retainedOperations from ship-draft-pr.ts instead of an unbound mock
**Gate:** prd-audit
**Rationale:** The leaf-bound prOperations is reused for a repository-target stack.read, which mutation-policy refuses as invalid-target. The task rem-prd-audit-R1-3 design (per-operation contexts) admits the fix.
**Criterion:** S6.1
**Parent task:** rem-prd-audit-R1-3
**Done when:**
- [test] S6.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-ready-target-binding is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-intent-restack: stack-publication.ts pushChildClosure: adopt an outstanding push intent (including for members not yet recorded) before comparing remote and recorded tips; restack/stack-preflight.ts: run the freeze before journal recovery; restack-recovery.ts: guard the follow-on restack; add crash-after-push retry and recovery-path tests
**Gate:** prd-audit
**Rationale:** pushChildClosure compares receipts before adopting an outstanding intent for a member not yet in the record. ADR decision 11 prescribes intent recovery, so this is code-ordering drift.
**Criterion:** S10.5
**Parent task:** rem-prd-audit-R10-3
**Done when:**
- [test] S10.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-intent-restack is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-divergence-mapping: remote-git-operations.ts/stack-tip-guard.ts: carry mismatched positions in the stack-tip-mismatch refusal; ship-draft-pr.ts and finish-publication.ts: map that refusal to haltStackTipDiverged; finish-publication-production.ts: route generic retarget divergence (~573/591/595) and typed divergence sites (~692/717/722/738/847) through haltStackTipDiverged with a real emitter, rendering mismatched positions; tests per site
**Gate:** prd-audit
**Rationale:** The typed refusal exists, but FINISH callers (ship-draft-pr.ts, finish-publication.ts) never map it to haltStackTipDiverged, and the halt names PRs rather than mismatched positions. This is implementation wiring.
**Criterion:** S10.6
**Parent task:** rem-prd-audit-R10
**Done when:**
- [test] S10.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-divergence-mapping is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-postfinish-refusal: post-finish-shipped-record.ts: detect the typed executeRemoteGit refusal (reason stack-tip-mismatch) rather than a legacy message string, skip and log while retaining the local shipped-record commit; test through the real executeRemoteGit refusal path
**Gate:** prd-audit
**Rationale:** Verified: isStackTipMismatch (post-finish-shipped-record.ts:181) matches only the legacy string, but the real refusal reason is 'stack-tip-mismatch'. This is a clear bug.
**Criterion:** S10.10
**Parent task:** rem-prd-audit-R11
**Done when:**
- [test] S10.10 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-postfinish-refusal is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-teardown-per-member: mergeable-sweep.ts/stack-teardown.ts: delete reachable children per member while keeping only unreachable ones; probe with rev-parse --quiet --verify; treat non-ancestry as keep, not failure; treat any non-zero delete exit as failure; look up plain tornDown receipts for child cleanup; retain watch enrollment on caught teardown failure; Task 28 tests including partial-teardown retry
**Gate:** prd-audit
**Rationale:** The sweep skips all child deletion when one member is unreachable. ADR decision 12 prescribes per-member retention, so this is implementation drift.
**Criterion:** S11.6
**Parent task:** rem-prd-audit-R13-2
**Done when:**
- [test] S11.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-teardown-per-member is committed and its targeted tests pass.

### Task rem-prd-audit-rem-v3-cli-stack-validation: github-operations-cli.ts/tracker-client.ts: apply validateStackPayload (membership, recorded stack number, retarget base in member branches) and the tip-guard fence to CLI stack.create/add/read and pull-request.retarget; refuse unrecorded child operations when the record is missing, unreadable or torn down; tests per operation
**Gate:** prd-audit
**Rationale:** The CLI stack.create path bypasses validateStackPayload. Task 7 already requires record-bound validation before any runner call.
**Criterion:** S12.4
**Parent task:** 7
**Done when:**
- [test] S12.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-v3-cli-stack-validation is committed and its targeted tests pass.

### Task rem-as-built-rem-v3-production-git-stdin: pr-labels.ts makeProductionGit: forward options.input to the child process stdin; add a test that persists a publication record through the production transport (index.ts/daemon-cli.ts wiring)
**Gate:** as-built
**Rationale:** makeProductionGit in pr-labels.ts has no stdin/input handling (grep confirms), so production hash-object gets no record data. This is a transport bug within Task 10.
**Parent task:** 10
**Governing clause:** Task 10
**Done when:**
- Task 10 is satisfied by this task.
- The repair for task rem-as-built-rem-v3-production-git-stdin is committed and its targeted tests pass.

### Task rem-as-built-rem-v3-preassembly-verify: stack-publication.ts stack observation: verify recorded members' bases and head SHAs against pushed tips even when requireDraft is true (unverified records), returning diverged before any assembly mutation; test a changed draft member pre-assembly
**Gate:** as-built
**Rationale:** Pre-assembly observation skips base/head checks when requireDraft is true. ADR decision 4 is clear; this is code drift.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 4
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 4 is satisfied by this task.
- The repair for task rem-as-built-rem-v3-preassembly-verify is committed and its targeted tests pass.

### Task rem-as-built-rem-v3-audit-child-exclusion: shipment-audit.ts: exclude stack child bodies before plan-level classification so they never decide absent/ambiguous; classify only legitimate leaf candidates (multiple → ambiguous); tests with a child mention plus one and two leaf candidates
**Gate:** as-built
**Rationale:** Child bodies still decide the plan-level absent result before ambiguity among multiple legitimate leaf candidates is evaluated. ADR decision 8 is explicit, so this is a code-ordering fix.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 8
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 8 is satisfied by this task.
- The repair for task rem-as-built-rem-v3-audit-child-exclusion is committed and its targeted tests pass.

### Task rem-as-built-rem-v3-malformed-state-indeterminate: stack-publication.ts member-state parsing: reject objects with missing/unknown state as indeterminate (not unreachable) so mergeable-sweep.ts records no tornDown and re-observes next sweep; tests for missing and unknown state
**Gate:** as-built
**Rationale:** A malformed member state is classified unreachable and recorded as terminal tornDown. ADR decision 9 requires indeterminate and retryable, so this is clear drift.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 9
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 9 is satisfied by this task.
- The repair for task rem-as-built-rem-v3-malformed-state-indeterminate is committed and its targeted tests pass.

### Task rem-as-built-rem-v3-park-reclaim-order: park-reconciliation.ts: mark the retained publication record tornDown on merged-park reconciliation without deleting positions/publication refs; daemon-park-cli.ts reclaim: remove the worktree first, then delete children only when shipped-record and reachability proof pass, otherwise keep children and still remove the worktree; Task 29 tests
**Gate:** as-built
**Rationale:** Task 29 specifies the cleanup order and tornDown retirement; the implementation deviates from it.
**Parent task:** 29
**Governing clause:** Task 29
**Done when:**
- Task 29 is satisfied by this task.
- The repair for task rem-as-built-rem-v3-park-reclaim-order is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-rem-v4-child-divergence-member: finish-publication-production.ts establishChildPrs (~979): when pushChildClosure returns diverged, call haltStackTipDiverged with only the diverging child's identity: its position, plus its PR number if a recorded or listed member exists, else no PR (never the leaf PR or earlier recorded members). Test in finish-publication-production tests: child 3 diverges after child 1 is recorded → the HALT subject lists position 3 only and the event carries no #c1 or leaf PR; diverging with nothing recorded → no leaf PR is named
**Gate:** prd-audit
**Rationale:** Verified (95%) at finish-publication-production.ts:979. On child-closure divergence, haltStackTipDiverged gets the stored record's members, or a fallback that pairs the leaf PR with the child position, instead of the diverging child. The HALT subject and the stack_tip_diverged event therefore name the wrong member. This is implementation drift under ADR decision 11 / Task 20, so it is BUILD work.
**Criterion:** S2.10
**Parent task:** rem-prd-audit-rem-v3-divergence-mapping
**Done when:**
- [test] S2.10 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-rem-v4-child-divergence-member is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-rem-v4-phase-aware-leaf-base: stack-publication.ts observeMembers: make base verification phase-aware. While the record is unassembled/unretargeted, the leaf (last member) must target the journaled pre-stack base (record.retarget.from, or the default base when unset). After retarget, it must target its predecessor. Children keep predecessor-base checks and all head-SHA checks stay. Fix the stack-publication-observe.test.ts fixture so the pre-retarget leaf reports the pre-stack base. Add a production three-member advanceFinishPublication dispatch test proving establish_child_prs → assemble_stack is selected (not stack_tip_diverged) and that a leaf already on the wrong base still diverges
**Gate:** prd-audit
**Rationale:** Verified (97%) at stack-publication.ts:399-401. observeMembers requires the leaf, the last member after establish_child_prs, to target its predecessor before assemble_stack has retargeted it. A correctly unretargeted leaf (base still the pre-stack base) is therefore reported as diverged, and FINISH halts instead of assembling. The test fixture hides this. The fix is a phase-aware check inside the approved observation design (ADR decision 5), so it is BUILD work.
**Criterion:** S4.1
**Parent task:** rem-as-built-rem-v3-preassembly-verify
**Done when:**
- [test] S4.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-rem-v4-phase-aware-leaf-base is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-rem-v4-first-child-base: stack-publication.ts observeMembers: always verify member 1's base. Use record.retarget.from when present, otherwise the record's journaled pre-stack/default base. Return indeterminate, not skip, if no expected base can be derived. Test: a record without retarget.from whose first child targets the wrong base → diverged; one targeting the correct base → healthy
**Gate:** as-built
**Rationale:** Verified (97%). Two defects sit in the same check. The leaf rejection is covered by the S4.1 task. Separately, the `expectedBase !== undefined` guard at stack-publication.ts:401 skips verifying the first child's base whenever retarget.from is absent. The approved ADR decision 5 requires first-child verification, so the fix is conforming BUILD work.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 5 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-rem-v4-first-child-base is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-rem-v4-n1-push-argv: remote-git-operations.ts guardPublishedStackPushes: decide whether a push is stacked without issuing Git commands for N=1 features. Gate on filesystem/sealed-plan child evidence (e.g. .pipeline/children or declared child positions) before calling hasDurableChildState or any for-each-ref/rev-parse. Read Git refs only when child evidence exists. Extend the N=1 golden argv test so an ordinary leaf push produces exactly the historical git argv, with no for-each-ref or publication-ref reads
**Gate:** as-built
**Rationale:** Verified (95%). In remote-git-operations.ts:176, every ordinary leaf push calls hasDurableChildState, and child-cursor.ts:140/:146 then runs two `git for-each-ref` commands. That changes the N=1 Git argv that ADR decision 1 and the N=1 golden suite require to stay unchanged. The repair can gate on non-Git evidence (the .pipeline/children directory or the sealed plan's child declaration) before any Git read. That fits the approved design, so it is BUILD work.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 1
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 1 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-rem-v4-n1-push-argv is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-rem-v4-second-read-indeterminate: finish-publication-production.ts readiness verification (~438-452): separate a transport failure, timeout or unparseable response of the stacks repository.read from a successfully read but mismatched membership. Surface failures as the existing indeterminate error so advanceFinishPublication returns publication_retry. Halt stack_tip_diverged only on a parsed mismatch. Test: a timed-out second read → publication_retry, with no HALT, no stack_tip_diverged event and no pull-request.ready
**Gate:** as-built
**Rationale:** Verified (97%) at finish-publication-production.ts:438-452. After the validated stack.read, a second stacks API read (runTrackerRepositoryRead) swallows all errors, so a timeout or transport failure becomes a terminal stack_tip_diverged HALT. The indeterminate-read repair already established retryable routing; this path just needs to reuse it. That is BUILD work.
**Parent task:** rem-prd-audit-rem-v3-read-indeterminate
**Governing clause:** Task rem-prd-audit-rem-v3-read-indeterminate
**Done when:**
- Task rem-prd-audit-rem-v3-read-indeterminate is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-rem-v4-second-read-indeterminate is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-rem-v4-teardown-keep-vs-fail: stack-teardown.ts deleteStackChildren: (a) a well-formed OPEN or CLOSED member response marks that member kept and continues; only malformed/unreadable responses return failed. (b) check both probe results for errors (merge-base exit >1, rev-parse exit >1) before acting on non-ancestry, returning failed so the sweep keeps retry enrollment. Tests: an OPEN member followed by a proven merged member → first kept, second deleted; a local-ref probe error alongside non-ancestry → failed, with no later update-ref -d
**Gate:** as-built
**Rationale:** Verified (93%) in stack-teardown.ts. Line 72 returns failed for a validly observed member that is not MERGED (OPEN/CLOSED), which stops later independently proven deletions instead of keeping that member. Line 80 continues on merge-base exit 1 before the local-ref probe error is checked at :84, so deletion proceeds after a Git error. ADR decision 12 already specifies the semantics: keep members whose proof legitimately fails, and stop with retry enrollment on observation errors. This is BUILD work.
**Governing clause:** adr-2026-10-17-stacked-feature-publication-as-native-stack decision 12
**Done when:**
- adr-2026-10-17-stacked-feature-publication-as-native-stack decision 12 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-rem-v4-teardown-keep-vs-fail is committed and its targeted tests pass.
