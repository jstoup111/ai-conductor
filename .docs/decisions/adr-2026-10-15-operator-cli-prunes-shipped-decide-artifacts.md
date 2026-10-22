# ADR: Operator CLI Prunes Shipped Features' DECIDE Artifacts

**Date:** 2026-10-15
**Status:** APPROVED
**Deciders:** James Stoup
**Issue:** jstoup111/ai-conductor#2963
**Amends:** adr-2026-08-23-committed-halt-record (D7), adr-2026-08-26-remove-retrospectives-one-shot (D5)

## Context

Committed `.docs` grows with every shipped feature's DECIDE artifacts. On 2026-10-03 the corpus
overflowed a 32 MiB `git cat-file --batch` read, and daemon discovery silently reported `eligible: 0`.
#2961 fixed that symptom and #2962 pruned the backlog by hand, but nothing stops the corpus growing
again.

The cleanup must work for a distributed team, must reach main only through a reviewed PR, and must
not halt in-flight features.

Several alternatives were evaluated and rejected:

- **A daemon sweep** sees only one machine's worktrees and races other daemons.
- **Pruning inside the feature's own PR at finish** loses build-time plan changes from main's
  history. The repository is squash-merge only, so remediation tasks appended to the plan would never
  reach main. It also needed a versioned `spec_hash`, a seal exception, and amendments to the seal and
  dedup contracts.
- **A companion PR per feature** doubles CI cost.

An operator-run command that prunes only stems whose shipped record is already on `origin/main`
avoids all of this:

- **The finish path is untouched.** The feature's plan merges with everything appended to it, so its
  remediation tasks reach main's history.
- **Shipment evidence never reads a pruned plan.** It verifies at the implementation PR head and
  merge commit, which predate the prune.
- **In-flight features already survive deletions that arrive from main.**
  `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal` (#1752, shipped in PR #3041) covers
  them.

Record-only repair and the shipment audit do read plans after ship.
`shipment-evidence-cli.ts` `expectedReconciledRecord` throws `plan … is unavailable` when the plan is
absent. Repair runs only when a record is absent, and this command prunes only stems that have one,
so a pruned stem reaches repair only in the edge case of a record later removed or corrupted. The
shipment audit reads every historical plan, though, so it needs the lookup routinely.

## Options Considered

### Option A: Operator-run CLI opening one guarded PR (chosen)
- **Pros:** Distributed-safe and reviewable. No change to finish, evidence or the seal. Plan history,
  including remediation tasks, survives on main.
- **Cons:** Runs only when an operator runs it, so artifacts accumulate between runs.

### Option B: Self-prune at the end of finish
- **Pros:** No lag, and no separate run.
- **Cons:** Squash merge erases remediation tasks and other build-time plan edits from main's
  history. It needs `spec_hash` v2, a seal exception, and amendments to three ADRs and two story sets.
  Rejected.

### Option C: Daemon sweep
- **Pros:** Automatic.
- **Cons:** Not distributed-safe. Rejected.

## Decision

1. **Retention policy.**
   - **Kept forever:** `.docs/stories`, `.docs/specs`, `.docs/decisions` (superseded ADRs included),
     `.docs/architecture`, `.docs/shipped`, `.docs/intake`, `.docs/release-waivers`.
   - **Prunable once a stem's shipped record is on `origin/main`:** `.docs/plans`, `.docs/conflicts`,
     `.docs/coherence`, `.docs/coherence-waivers`, `.docs/track`, `.docs/complexity`, `.docs/halted`,
     `.docs/plan-review`, `.docs/applicability`, `.docs/retros`.
   - **Stem matching:** a file belongs to a stem by its plan stem, its undated form, or the
     family's existing `normalized-stem` identity. When an undated form matches more than one plan
     stem on `origin/main`, files that match only by that undated form are excluded and reported, the
     same way discovery treats a colliding undated marker as ambiguous.
   - **Never touched:** repository-wide files (`audit`, `audits`, `baselines`, `observation`, and
     top-level `.docs/*.md`).
   - **Single source:** the policy is one exported constant. No caller hard-codes a family list.

2. **One operator-run command.**
   - **Command:** `ai-conductor docs-prune` is registered in the CLI command table.
   - **Selection:** it fetches `origin/main` and selects the prunable files of every stem whose
     `.docs/shipped/<stem>.md` exists there.
   - **Never automatic:** it runs only when invoked. No daemon tick, finish step or CI job calls it.

3. **Deferral by open PR.**
   - **Rule:** when an open PR adds, modifies or deletes any selected path of a stem, the stem's
     whole prunable set is deferred with reason `open-pr-modifies`. A stem is never split, so its
     plan and its markers are always removed together. That keeps discovery's undated-stem lookup
     (`daemon-backlog.ts` `undatedPlanStemCounts`) from adopting a stray marker.
   - **Source:** open-PR changed-file lists come from a guarded GraphQL read
     (`runTrackerGraphqlRead`) that follows every PR and every file cursor. It generalizes the
     module-private paginated reader in `shipment-audit.ts`, which is hard-coded to `MERGED` today,
     to take the PR state. `gh pr view --json files` is not used, because it caps at 100 files.
   - **Failure:** if that read fails, or any cursor repeats or a page is incomplete, the command
     publishes nothing and exits non-zero.
   - **Accepted residual:** an unpushed local branch that modified a selected unsealed path, such as
     another stem's `.docs/coherence` file, hits a modify/delete conflict on its next rebase. The
     edit is never silently discarded: the rebase either keeps the edited file (the `.docs` keep-both
     staging in `rebase.ts` `runTier1`) or stops with a conflict naming the path. Once that branch's PR
     is open, D3 defers the stem. Sealed `.docs/plans` files of another feature cannot carry such an
     edit, because the seal and the pre-commit protection already refuse it.

4. **Guarded, reviewable publication.**
   - **Pattern:** the commit is made in a temporary detached worktree and pushed to one deterministic
     `docs-prune/<date>` branch through the existing repair-publication pattern
     (`shipment-reconciliation.ts`, `makeProductionRepairPublisher`).
   - **Docs-only:** the commit is refused unless every touched path is a selected prunable path.
   - **Idempotence:** the operator's own open `docs-prune/*` PR is refreshed, never duplicated. The
     command never pushes `main`, enables auto-merge or merges. With nothing to prune, it creates no
     branch or PR.
   - **Authorization (`adr-2026-09-11-github-operation-ownership` D4):** a docs-prune branch and PR
     have no feature owner. Each remote write, meaning the branch push and the PR create or PR edit,
     is authorized by the existing exact-request interactive approval
     (`github-operation-approval.ts` `requestExplicitGithubOperationApproval`). That approval binds the
     actor, the repository, the exact target and operation, and the payload digest. The push passes
     it as `explicitApproval` to the guarded remote Git adapter, and the PR writes pass it to the
     guarded operation runner. A declined prompt, a non-interactive terminal, or no confirmation
     adapter refuses that write, and nothing after it runs. The command is not in the daemon-session
     sanctioned set, so the existing entry guard (`daemon-session.ts`
     `guardDaemonSessionInvocation`) refuses it inside an engine-dispatched session before any work.
   - **Another operator's PR (D2 of the same ADR):** when an open `docs-prune/*` PR authored by
     anyone other than the resolved operator exists, the command publishes nothing and exits
     non-zero naming that PR. It never refreshes or closes it.

5. **Reporting on the existing spine.**
   - **PR body:** lists every removed path, and every deferred path with its reason.
   - **Event:** the command emits one new `decide_artifacts_pruned` variant on the `ConductorEvent`
     union. It carries the removed paths, the deferred paths with reasons, and the PR URL. It is
     persisted by `EventPersister` to the repository root's git-ignored `.pipeline/events.jsonl`,
     as `rewind.ts` does for its repository-level events.
   - **Skip reasons:** a closed union, `open-pr-modifies` or `no-shipped-record`.
   - **No new channel:** no sidecar file or separate log is added.

6. **Pruned-plan lookup for repair and audit.**
   - **Lookup:** when record-only repair (`expectedReconciledRecord`) or the shipment audit needs a
     stem's plan and the plan is absent at the commit being read, both use one shared lookup. It reads
     the plan from the parent of the most recent commit that deleted it (`git log -1 --diff-filter=D`).
   - **Refusal:** when no deleting commit is reachable from the commit being read, repair refuses
     with `shipment-plan-pruned`, naming the path, in place of the generic `plan … is unavailable`.
     The audit classifies that one row `unresolved` with reason `shipment-plan-pruned` and still
     classifies every other row. One such case is a plan that exists only on an unmerged branch,
     which the audit enumerates with `git log --all`.
   - **Scope of the lookup:** it applies to every plan deleted from main, not only plans pruned by
     this command. Stems that `#2962` pruned by hand, and the retired stems of
     `.docs/stories/abandoned-specs-are-kept-in-git-instead-of-the-iss.md` Story 3, are therefore
     classified from their pre-deletion plan rather than reported as missing at the audit head.
   - **Rest unchanged:** `spec_hash` and shipment evidence are not changed.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | In-flight features tolerate a merged docs-prune deletion of paths they never modified. Of the prunable families only `.docs/plans` is sealed (`PROTECTED_ARTIFACT_DIRECTORIES`), and the #1752 path in `protected-artifact-seal.ts` `classifyDeletedProtectedArtifact` tolerates a base-side deletion the feature never touched | verified | 90% | yes | Merging a docs-prune PR halts in-flight features | Approved by operator 2026-10-21 |
| A2 | Shipment evidence reads plans only at implementation PR heads, PR merge commits or candidate commits, never at main after a prune (every `evaluateShipmentEvidence` caller). Record repair through `makeRecordRepairRequester` fires only when the record is absent from main, so it cannot reach a pruned stem. The manual `shipment-evidence audit` reads plan presence at the audit head and would report pruned stems `unresolved`, which D6 covers | verified | 85% | yes | A later evidence run on a pruned stem refuses; D6's lookup would have to extend to the verifier | Approved by operator 2026-10-21 |
| A3 | A cursor-paginated guarded GraphQL read of open PRs and their files covers every path a pushed in-flight branch touches. The building blocks exist (`runTrackerGraphqlRead`, the `shipment-audit.ts` file-cursor reader); no open-PR enumerator exists yet, so D3 adds one | verified | 85% | yes | A pushed feature branch editing a pruned path conflicts after merge | Approved by operator 2026-10-21 |
| A4 | After ship, no production reader needs a shipped stem's prunable file. Every reader of the prunable families is keyed to the active feature's slug or plan stem, except `conductor.ts` `resolveTrack`. It reads the alphabetically last `.docs/track` file only when `state.track` is unset, which happens in interactive runs because the daemon seeds the track. That is an existing defect, which pruning makes less likely to fire. It is out of scope and filed as #3334 | verified | 85% | yes | A reader for a shipped stem fails or loses data | Approved by operator 2026-10-21 |
| A5 | Pruning shrinks feature-scoped families, which makes the legacy singleton fallback of `adr-2026-07-28-feature-aware-artifact-resolution` D3.4 (`artifacts.ts` scoped resolution accepts a lone unassociated candidate) more likely to resolve another feature's artifact for a step whose own artifact is missing. It is an existing mechanism, accepted as a residual and filed as #3338. Daemon builds preseed DECIDE and are less exposed | verified | 80% | yes | An interactive step completes on a foreign artifact | Approved by operator 2026-10-21 |

## Consequences

### Positive
- The corpus can be cut back at any time, by any operator, through one reviewed PR, with no daemon
  dependency and no idle window.
- Plans, including remediation tasks, keep their full history on main.
- The finish path and the evidence and seal contracts do not change.

### Negative
- Pruning happens only when someone runs the command, so `.docs` grows between runs.
- Pruned artifacts live only in git history. Committed halt records of shipped stems leave main.
  The dashboard's halted list is unaffected, because it reads worktree state, not `.docs/halted`.
- `ai-conductor daemon park <shipped-slug>` and `reconcile-parked` refuse for a pruned slug whose
  worktree is gone. Both are already finished features, so this is accepted.

### Follow-up Actions
- [ ] Close stale #1676 as resolved by #1752 (PR #3041).
