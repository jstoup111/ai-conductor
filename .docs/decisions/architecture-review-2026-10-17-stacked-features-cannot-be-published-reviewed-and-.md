# Architecture Review: Publish, review and ship a stacked feature as a GitHub native stack (#2945)

**Date:** 2026-10-17
**Stories reviewed:** none yet. This is the pre-stories review of a technical-track feature. The
inputs were:
- the track marker `.docs/track/stacked-features-cannot-be-published-reviewed-and-.md`, whose
  ship-path scope is binding;
- the complexity record (Tier L);
- the operator-approved diagrams in `.docs/architecture/stacked-features-cannot-be-published-reviewed-and-.md`.

**Verdict:** APPROVED WITH CONDITIONS

## Scope

This review covers the ship-path slice of #2945 using approach B, which publishes with existing
contracts. The operator decided:
- the scope (2026-10-17);
- approach B over the filer's `bundled` contracts, which are filed as #3267;
- one spec rather than a split, at an estimated 21 tasks;
- engine-rendered child bodies;
- top-down ready flips;
- freezing engine rewrites of a published stack.

`stack adopt` and refresh go to #3268, routed-fix comments to #3269, and red intermediate CI to
#3270.

## Review process

- Two read-only exploration agents surveyed the engine code, the chain ADRs, the workflows and the
  validators.
- The draft ADR then went through two adversarial reviews: Codex (read-only, 20 findings, 10
  blocking) and Claude Opus (2 blocking, 10 significant, 7 minor). The two reviewers converged on
  most items.
- Every finding was folded into the ADR rewrite, and a bounded Codex re-check followed.
- The findings that changed decisions were:
  - partial progress tripping `publication_transition_unmoved`;
  - open-only member discovery;
  - `leafBase` written before the retarget;
  - reused ready PRs;
  - ready-flip races;
  - the tip guard running before push-intent recovery;
  - create-only pushes being impossible today;
  - non-contiguous positions;
  - the flag overriding durable child state;
  - FINISH or re-kick restacks silently splitting a published stack;
  - pushes outside the guard's named list;
  - prose dispatch having no child context;
  - `repairPresentation` being leaf-specific;
  - shipment adapters lacking the head ref;
  - `--base` lookups breaking after the retarget;
  - teardown order and retry.

## Verified facts

These are recorded in the ADR's Context section, cited by module and symbol at spec base
`757ae99776`, with GitHub documentation read on 2026-10-17. The facts that drive the design are:
- **Stacks API preconditions:** create takes chained bases, bottom to top, and accepts draft
  members.
- **Actions trigger semantics for stack members:** workflows run as if each member targets the
  stack base.
- **The loose plan-path match** in reconcile and the audit (the false-ship hazard).
- **Lookups that assume the default base:** the retained draft, release metadata, regions, halt
  clearing and readiness.
- **The one push choke point**, `executeRemoteGit`, and its push-intent recovery.
- **Teardown** never deletes a local branch today, and the repository sets
  `delete_branch_on_merge: true`.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. It uses the existing `gh` runner, the guarded operation registry, git plumbing (`update-ref`, `ls-remote`, `push --force-with-lease`) and one workflow edit |
| Prerequisites | Chain tickets T1–T5 are shipped. GitHub stacks are GA (2026-10-06) and already used on this repository (stacks #1570, #2085, #2265, #2967) |
| Integration surface | High. FINISH publication, the guarded GitHub boundary, remote git, the mergeable sweep, shipment evidence (premerge, reconcile, audit), halt classes, restack call sites, events and `ci.yml`. That is more than three module boundaries plus an external API, which the complexity record already accepts as Tier L |
| Data implications | One new ref-backed record (`refs/conductor/<slug>/publication`). No schema migration. `conduct-state.json`, shipped records and the PR template are unchanged |
| Performance risk | Low. Publication makes O(N) GitHub calls with N ≤ 9. The sweep adds one stack read per visit to a stacked entry, plus a revert search for merged members only while the leaf is open |
| Worktree isolation | No new ports, services or shared files. The record is a per-slug ref in the shared git dir, written by compare-and-swap |

## Complexity

High, on the component, external-integration and state-machine signals. The operator declined a
split after the §3a estimate of about 21 tasks, which is under the 30-task land refusal. The
remaining risk is concentrated in crash and resume ordering, which the ADR pins down per
transition.

## Alignment

- **Governing ADRs reused, not duplicated:**
  - umbrella identity ADR decisions 2, 3, 12 and 14;
  - build-region ADR decisions 2 and 11;
  - restack ADR decisions 9 and 11;
  - routed-repair ADR (runs before publication);
  - `adr-2026-09-11-github-operation-ownership` D1 and D2;
  - `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` decision 3, whose ship
    gate is unchanged;
  - `adr-2026-07-07-finish-record-primitive` D3, whose child refusal is kept.
- **Uncovered structural decisions:** these get a new ADR,
  `adr-2026-10-17-stacked-feature-publication-as-native-stack`:
  - multi-member publication;
  - the publication record;
  - stack assembly through a new external API seam;
  - the published-stack freeze and tip guard;
  - the head-ref shipment guard;
  - stack teardown.

  Its amendments are listed in the ADR's "Amendments made by this decision" section, and each
  amended ADR carries an additive note.
- **One-PR-per-branch** (`adr-2026-08-09-one-pr-per-branch-halt-is-a-state`) is compatible and not
  amended. Every branch, child or leaf, still has exactly one PR, and halt state lives only on the
  leaf's retained PR.
- **Release metadata** (`adr-2026-08-01-bot-owned-release-pr`) is not amended. Children carry a
  valid `no-note`, and every merged member remains an auditable candidate.
- **Event spine:** six new union members, emitted through the conductor emitter and the sweep's
  existing `onEvent`. `stack_member_lifecycle` uses the persister's `eventId` de-duplication. The
  `lastSeen` field in the record is durable state (exception C), not a second channel.
- **State management:**
  - The stack dimension is an explicit enum.
  - `retarget.phase` is an enum (`intended`, `observed`), not a boolean.
  - Member order is the sealed positions array, never an ordinal range.
- **Security boundaries:**
  - Every remote write is guarded under committed ownership.
  - `stack.create` is a narrow, payload-validated second exemption, bound to the leaf's ownership.
  - No ruleset is touched, and no merge is ever performed.
- **Production DI defaults:** the record store is git-backed. No in-memory default exists.
- **Diagrams** were updated in place after review and render (5 of 5).

## Domain Integrity

- **Semantic types:**
  - `ChildId`, the branded 1..9 type, keys every member.
  - Member order is the sealed positions array.
  - Stack number and PR number are typed fields in the record parser, not raw strings passed
    around.
- **Parse, don't validate:**
  - The record is parsed once into a typed value with a version check.
  - Payloads for `stack.*` and `pull-request.retarget` are decoded at the boundary and checked
    against the record.
- **Invalid states unrepresentable:**
  - The stack dimension is an enum.
  - A member cannot be `published` without a PR number.
  - `retarget.observed` requires `to`.
- **Exhaustive matching:** the new halt class, stack dimension values and event members are added
  to closed unions, so switches over them must stay exhaustive. Deliberately, there is no catch-all
  default for the stack dimension.

## Wiring Surface

| Surface | Production caller |
|---|---|
| Stack observer (stack dimension) | `observePublicationSnapshot`, reached from `advanceFinishPublication` in the FINISH dispatch |
| `establish_child_prs` effect | `advanceFinishPublication`, selected by `nextFinishPublicationTransition` |
| `assemble_stack` effect | `advanceFinishPublication`, selected by `nextFinishPublicationTransition` |
| Child-only ready flip | the `ready_pr` effect in `finish-publication-production.ts` |
| Child body renderer | `establish_child_prs`, and the `## Stack` re-render in `assemble_stack` |
| Publication record store | the two effects, the stack observer, the sweep, the lookups and the restack refusals |
| Child closure-SHA plain push after `ls-remote` | `establish_child_prs` through `executeRemoteGit` |
| Stack tip guard | `executeRemoteGit`, for every caller, and `pull-request.retarget` |
| `stack.read`, `stack.create`, `stack.add`, `pull-request.retarget` registry operations | the effects above, through `executeGithubOperation` and `tracker-client.ts` `ghArgsFor` |
| `stack-tip-diverged` halt class | the FINISH publication routing on a guard refusal or a `diverged` stack dimension |
| `published-stack` restack refusal | the FINISH `rebase` step and the stack preflight in `conductor.ts`, the re-kick base refresh in `daemon-rekick.ts`, the routed exit restack, and route admission |
| Child-branch refusal in `conduct github-operation` | `github-operations-cli.ts` push and PR-bind paths |
| Stack-member deletion proof | the sweep reap and `reclaim-worktree` child deletion |
| ci-fix freeze | the ci-fix eligibility check in the mergeable sweep and `ci-fix.ts` |
| Head-ref `stack-child` guard | `classifyShipmentAssociation`, called by `shipment-evidence` check and reconcile (the `shipped-record.yml` workflow) and by `runShipmentAudit` |
| Two-base leaf lookups | `resolveRetainedShipDraftPrUrl`, `readShipDraftReleaseMetadata`, region prepare and capture, `clearRetainedHaltStateForDispatch` |
| Member lifecycle, reachability and child teardown | the mergeable sweep's open and merged branches, `reclaim-worktree` in `daemon-park-cli.ts`, and `deleteFeatureConductorRefs` (explicit list) |
| Six new events | the conductor emitter (FINISH) and the sweep's `onEvent`, each with an event-sinks registry row |
| `ci.yml` `feat/c*/**` filter | GitHub `pull_request` events on member PRs |

Every engine surface is reached only for a stacked feature. A non-stacked feature never reaches
them, because the stack observer answers `not-applicable` from local refs. The as-built sweep must
accept the stacked caller chain from `advanceFinishPublication` and from the sweep.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A merged child mints the feature's shipped record through the loose plan-path match in reconcile | Data | Medium | High | Decision 8's head-ref `stack-child` guard in every shipment mode, plus rendered child bodies with no plan path (decision 6) |
| A crash between a GitHub write and the record's compare-and-swap leaves a duplicate or orphaned member | Integration | Medium | High | Discovery by head ref in every state, re-discovery before retry, journaled retarget phase (decisions 2, 4, 5) |
| A FINISH or re-kick restack rewrites published children, and only the leaf is pushed | Data | Medium | High | The published-stack freeze at both restack call sites, plus local-versus-pushed verification before each child push (decisions 4, 11) |
| Upper members never get `ci-gate` | Integration | High without the fix | High | The `ci.yml` `feat/c*/**` filter (decision 8). A2 and A3 still need operator approval |
| A partial merge or human push makes the engine overwrite a server-side rewrite | Data | Low | High | The tip guard runs at `executeRemoteGit` after push-intent recovery, and FINISH halts once with a sweep-skipped class (decision 11) |
| A non-stacked feature regresses | Technical | Low | High | The stack observer short-circuits on local refs before any GitHub read. Goldens are extended to transition events and argv (decision 1) |
| The leaf's retained draft cannot be found after the retarget | Integration | High without the fix | High | Every base-dependent lookup accepts exactly the two journaled bases (decision 5) |
| GitHub stack API behavior changes | Integration | Low | Medium | One adapter in the guarded registry; the `indeterminate` stack dimension fails closed |
| Operators partially merge, then wait | Knowledge | Medium | Medium | The runbook and the ADR state "merge the stack in one go". #3268 removes the constraint |
| Child bodies are less informative than authored prose | Knowledge | Medium | Low | The body cites the accepted stories, tasks and diffstat. Authored child prose can follow later |

## ADRs Created

- `adr-2026-10-17-stacked-feature-publication-as-native-stack`: APPROVED by the operator on 2026-10-17, with assumptions A2–A6 approved.

## Conditions

1. The ADR reaches `Status: APPROVED`, with A2–A7 approved by the operator, before stories are
   written.
2. The plan carries an `## Architecture Obligation Coverage` row for every decision of the new ADR
   and of every amended ADR.
3. The N=1 golden suite is extended before any stacked path is enabled. It must cover the FINISH
   transition-event sequence, gh and git argv, the PR body, and the shipped record's Cost and Time
   blocks. The allowance pin stays at 2 × 7 for N=1.
4. The plan includes a test proving that no shipment mode classifies a child-branch head as an
   implementation PR, whatever its body says.
5. The plan includes crash-injection tests at each record write in `establish_child_prs` and
   `assemble_stack`. Each one must resume to the same member set without a duplicate PR.
6. The runbook section for `stack-tip-diverged` is delivered by #3273, a documentation hotfix after this spec merges, by operator decision (2026-10-17). This spec's halt record names that runbook section as its recovery pointer.

## Early overlap scan (advisory)

`ai-conductor overlap-scan` over the wiring paths reported only stale spec branches:
- `origin/spec/daemon-self-host-guardrails`: `conductor.ts`, `halt-marker.ts`, `daemon-rekick.ts`;
- `origin/spec/self-host-phase6-wiring`: `conductor.ts`.

Open chain work #3211 and #3212 (routed repair) also edits `conductor.ts`. `/conflict-check`
should weigh it.
