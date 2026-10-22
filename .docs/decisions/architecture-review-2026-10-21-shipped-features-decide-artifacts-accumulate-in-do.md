# Architecture Review: Operator CLI Prunes Shipped Features' DECIDE Artifacts

**Date:** 2026-10-21
**Stories reviewed:** none yet. This is the pre-stories lightweight pass (Medium tier). Its input is
the explore output, the track scope boundary, the architecture diagram and issue #2963.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility.** No new package, service or infrastructure is needed. The command uses the
  existing git runner, the guarded tracker GraphQL read (`tracker-client.ts` `runTrackerGraphqlRead`),
  the guarded repair-publication pattern (`shipment-reconciliation.ts` `publishShipmentRepair`,
  `shipment-evidence-cli.ts` `makeProductionRepairPublisher`) and `ConductorEventEmitter`.
- **Prerequisites.** All are already on main:
  - #1752 shipped in PR #3041. In-flight features tolerate deletions of sealed plans that arrive from
    main (`protected-artifact-seal.ts` `classifyDeletedProtectedArtifact`). Of the prunable families,
    only `.docs/plans` is sealed.
  - #2961 split the `cat-file` batch reads.
  - #2962 pruned the backlog once by hand.
- **Integration surface.** The change touches four areas:
  - a new prune module;
  - the CLI table (`cli.ts`, `cli-pre-dispatch.ts`);
  - the shipment repair and audit readers (`shipment-evidence-cli.ts`, `shipment-audit.ts`);
  - the event union (`types/events.ts`).

  It calls one external API, GitHub, only through guarded reads and the guarded publisher.
  Complexity is Medium, which matches the tier.
- **Data implications.**
  - No schema changes and no change to `spec_hash`, shipment evidence or the seal.
  - The first run removes the prunable files of about 75 shipped stems, a few hundred files in one
    reviewed docs-only PR. Git history keeps every file.
  - The two on-main ADRs that promised those files remain are amended:
    `adr-2026-08-23-committed-halt-record` D7 and `adr-2026-08-26-remove-retrospectives-one-shot` D5.
    Both amendments are committed on the spec branch.
- **Performance.**
  - Selection makes one `ls-tree` pass over `origin/main`.
  - The open-PR read follows PR and file cursors. It is bounded by the open-PR count and fails closed
    on a repeated cursor or an incomplete page, the same as the existing `shipment-audit.ts` file
    reader.
  - The pruned-plan lookup runs one `git log -1 --diff-filter=D` per pruned stem the audit reads.
- **Worktree isolation.** The commit is made in a temporary detached worktree, the same way the
  repair publisher works. There are no ports, databases or shared mutable state. The command never
  writes to the root checkout, so it is safe while a self-host build runs (CLAUDE.md rule 5).

## Alignment

- **ADR-005 non-autonomy boundary.** Nothing pushes `main` or merges. The prune reaches main only
  when an operator merges the `docs-prune/<date>` PR.
- **`adr-2026-10-07-prune-base-inherited-deletions-from-the-seal`.**
  - Reused, not loosened. A merged prune is an inherited deletion for every in-flight feature that
    never touched the path.
  - D3's stem-level open-PR deferral keeps out the one case #1752 refuses: a feature that edited the
    path itself.
  - An unpushed local edit to a pruned path remains. The `.docs` keep-both rebase resolver keeps
    the edited file, so the edit is preserved.
- **`adr-2026-07-25-fail-closed-durable-shipment-evidence`.** Not amended.
  - Every `evaluateShipmentEvidence` caller reads a PR head, a merge commit or a candidate commit.
    Every one of those predates the stem's prune.
  - The fail-closed property is unchanged. The new lookup serves only record-only repair and the
    manual audit, and it refuses specifically (`shipment-plan-pruned`) rather than guessing.
- **`adr-2026-08-23-committed-halt-record` D7 and `adr-2026-08-26-remove-retrospectives-one-shot` D5.**
  Both now carry amendment notes limiting their "never deleted" and "remain as records" promises to
  stems not yet shipped. Their other decisions are unchanged. No open PR or spec worktree touches
  either ADR.
- **Discovery dedup (`daemon-backlog.ts`).**
  - Dedup reads `.docs/shipped` only, so pruning a shipped stem's plan just removes it from the
    candidate list.
  - The undated-stem lookup (`undatedPlanStemCounts`) counts every plan. A stem is therefore never
    split: the ADR's D3 defers a stem's whole prunable set together.
- **Event spine (CLAUDE.md, `.agents/skills/event-spine/SKILL.md`).** Reporting adds one
  `ConductorEvent` variant plus the PR body. No sidecar, watcher or log is added, so it passes the
  schema-not-file test.
- **`adr-2026-09-11-github-operation-ownership`.** Not amended. The docs-prune branch and PR have
  no feature owner, so D4 applies. Each remote write uses D4's existing operator approval
  mechanism, the exact-request interactive approval (`requestExplicitGithubOperationApproval`). The
  push passes it as `explicitApproval`, and the PR create or edit passes it to the guarded runner.
  The existing daemon-session entry guard refuses the command inside a dispatched session. Per D2,
  it refuses rather than refreshing another operator's open `docs-prune/*` PR.
- **`adr-2026-07-28-feature-aware-artifact-resolution` D3.4.** Not amended. Pruning makes the legacy
  singleton fallback more likely to resolve a foreign artifact. Recorded as ADR assumption A5 and
  filed as #3338.
- **Daemon Operations Safety rule 4.** The finish stays `shipped-record`. The command reads shipped
  records and never writes or replaces one.
- **Scope boundary.** Matches the track: operator-run only, with no daemon sweep, finish-time prune
  or CI trigger. The `resolveTrack` defect found during review is out of scope (#3334).
- **Diagram accuracy.** `.docs/architecture/shipped-features-decide-artifacts-accumulate-in-do.md`
  matches this design. The CLI registers in `cli.ts` (commander) and the pre-dispatch table, not in
  `index.ts`.
- **Local pattern basis: guarded repair publication.**
  - **Role:** publishing an engine-authored, docs-only commit to a deterministic branch and PR.
  - **Traits to keep:** a detached temporary worktree; pushes only to a deterministic non-`main`
    branch through the guarded remote mutation; refreshes an open PR instead of duplicating it;
    never merges; checks that only the expected paths change before committing.
  - **Allowed variation:** branch prefix `docs-prune/` and the PR body content.
  - **Rediscovery hints:** `shipment-reconciliation.ts` `publishShipmentRepair`,
    `shipment-evidence-cli.ts` `makeProductionRepairPublisher`.
- **Local pattern basis: paginated changed-file read.**
  - **Role:** listing every changed path of a PR without a cap.
  - **Traits to keep:** GraphQL `files` cursor pagination through the guarded tracker read; a
    page-count bound; fails closed on a repeated or incomplete cursor.
  - **Allowed variation:** the PR state filter becomes a parameter (`OPEN` here, `MERGED` in the
    audit).
  - **Rediscovery hints:** `shipment-audit.ts` `remainingChangedPaths` and its `pullRequests` query,
    `MAX_GRAPHQL_PAGES`.

## Wiring Surface

| Surface | Production caller (design-time) |
|---|---|
| Retention policy constant (kept and prunable families) | Imported by the `docs-prune` selector. Nothing else hard-codes a family list |
| Shipped-stem prune-set resolver | Called by the `docs-prune` command handler |
| Open-PR changed-file reader (state-parameterized) | Called by the `docs-prune` deferral step. The existing shipment audit keeps calling it with `MERGED` |
| Docs-only prune publication | Called by the `docs-prune` command handler through the guarded repair-publication pattern |
| `ai-conductor docs-prune` subcommand | Registered in the commander table in `src/conductor/src/cli.ts` and the `cli-pre-dispatch.ts` command list |
| `decide_artifacts_pruned` event | Emitted by the command through `ConductorEventEmitter` and persisted by `EventPersister` |
| Pruned-plan lookup and `shipment-plan-pruned` refusal | Called by `expectedReconciledRecord` (`shipment-evidence-cli.ts`) and by the shipment audit's plan-presence check (`shipment-audit.ts` `runShipmentAudit`) |

**Early overlap scan (advisory):** `ai-conductor overlap-scan` over `cli.ts`, `cli-pre-dispatch.ts`,
`shipment-evidence-cli.ts`, `shipment-audit.ts`, `shipment-reconciliation.ts`, `tracker-client.ts`
and `types/events.ts` reported no overlap and no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A pushed in-flight branch edits a pruned path, and the prune merges first | Integration | Low | Medium | D3 defers the whole stem while any open PR touches it; a page failure publishes nothing |
| An unpushed local branch edits a pruned path | Integration | Low | Low | Accepted residual; the keep-both rebase resolver preserves the edited file, and D3 defers the stem once its PR is open |
| The audit reports pruned stems `unresolved` | Data | High without D6 | Medium | D6's shared lookup reads the plan from the parent of the deleting commit; covered by a story |
| A stem split between pruned and deferred lets the undated lookup adopt a stray marker | Data | Low | Medium | Deferral works on whole stems (D3) |
| The first PR is large (a few hundred deletions) | Integration | High | Low | Docs-only, one review, every removed and deferred path listed in the PR body |
| A rerun while a `docs-prune` PR is open duplicates it | Integration | Medium | Low | D4 refreshes the open PR on the deterministic branch |

## ADRs Created

- `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts`. Assumptions A1–A4 approved by the
  operator 2026-10-21. APPROVED by the operator 2026-10-21.
- Amended: `adr-2026-08-23-committed-halt-record` (note beside D7) and
  `adr-2026-08-26-remove-retrospectives-one-shot` (note beside D5).

## Conditions

1. The plan must carry Architecture Obligation Coverage rows for every decision of the new ADR
   (D1–D6), of `adr-2026-08-23-committed-halt-record`, and of
   `adr-2026-08-26-remove-retrospectives-one-shot`.
2. Stories must prove, against real git fixtures, that an in-flight feature that never touched a
   pruned path survives the merged prune without a halt or reseal.
3. Stories must prove the open-PR read fails closed on an incomplete or repeated cursor, and that a
   page past 100 files is still read.
