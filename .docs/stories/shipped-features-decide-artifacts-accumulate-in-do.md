**Status:** Accepted

# Stories: Operator CLI prunes shipped features' DECIDE artifacts (#2963)

**Track:** technical. There is no PRD; acceptance criteria are defined here.
**Design:** `.docs/architecture/shipped-features-decide-artifacts-accumulate-in-do.md`
**Decision:** `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts` (APPROVED). It amends
`adr-2026-08-23-committed-halt-record` D7 and `adr-2026-08-26-remove-retrospectives-one-shot` D5.
**Review:** `architecture-review-2026-10-21-shipped-features-decide-artifacts-accumulate-in-do`
(APPROVED WITH CONDITIONS)

Requirement tags reference the approved decision record: `ADR-N` is decision item N of
`adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts`, and `RC-N` is condition N of the
architecture review.

Terms used throughout:
- **Kept families:** `.docs/stories`, `.docs/specs`, `.docs/decisions`, `.docs/architecture`,
  `.docs/shipped`, `.docs/intake`, `.docs/release-waivers`.
- **Prunable families:** `.docs/plans`, `.docs/conflicts`, `.docs/coherence`,
  `.docs/coherence-waivers`, `.docs/track`, `.docs/complexity`, `.docs/halted`, `.docs/plan-review`,
  `.docs/applicability`, `.docs/retros`.
- **Shipped stem:** a stem whose `.docs/shipped/<stem>.md` record exists on `origin/main`.
- **Prune set of a stem:** the files in prunable families that belong to the stem by its plan stem,
  its undated form, or the family's normalized-stem identity.

Every scenario uses real git fixtures: a bare origin, a `main` branch, and worktrees. GitHub is
mocked at the guarded tracker boundary.

---

## Story 1: The retention policy selects only shipped stems' prunable files

**Requirement:** ADR-1

As an operator, I want one retention policy that names exactly which files a cleanup may remove, so
no cleanup can delete a contract artifact, a repository-wide file, or an unshipped feature's work.

### Acceptance Criteria

#### Happy Path
- Given `origin/main` holds `.docs/shipped/alpha.md` and an `alpha` file in every prunable family, when `docs-prune` resolves its selection, then the selection holds exactly those prunable files of `alpha`.
- Given shipped stem `2026-10-01-alpha` whose conflicts file is the undated `.docs/conflicts/alpha.md` and whose retro is `.docs/retros/2026-10-02-alpha.md`, when the selection is resolved, then both files are included.
- Given shipped stem `alpha` with a committed halt record `.docs/halted/alpha.md`, when the selection is resolved, then the halt record is included.

#### Negative Paths
- Given shipped stem `alpha` with a file named for `alpha` in each of the seven kept families (stories, specs, an ADR in decisions, architecture, shipped, intake and release-waivers), when the selection is resolved, then none of those files is included.
- Given shipped stem `alpha` and unshipped stem `alpha-two` whose files share the `alpha` prefix, when the selection is resolved, then no `alpha-two` file is included.
- Given unshipped stem `beta` with files in every prunable family and no `.docs/shipped/beta.md` on `origin/main`, when the selection is resolved, then no `beta` file is included and `beta` is reported as skipped with reason `no-shipped-record`.
- Given repository-wide files under `.docs/audit`, `.docs/audits`, `.docs/baselines`, `.docs/observation` and top-level `.docs/*.md`, when the selection is resolved, then none of them is included.
- Given a shipped record that exists only on a local branch and not on `origin/main`, when the selection is resolved, then that stem's files are not included.
- Given shipped stem `2026-10-01-alpha` and unshipped stem `2026-10-20-alpha` both with plans on `origin/main`, and an undated `.docs/conflicts/alpha.md`, when the selection is resolved, then `.docs/conflicts/alpha.md` is not included and is reported as excluded because its undated stem matches more than one plan.

### Done When
- [ ] One exported retention-policy constant lists the kept and prunable families, and the `docs-prune` selector reads its family list only from that constant.
- [ ] A selector test over a real-git fixture containing every family proves each include and exclude case above.

---

## Story 2: The operator removes shipped artifacts through one reviewable docs-only PR

**Requirement:** ADR-2, ADR-4

As an operator, I want one command that turns the selection into a reviewable PR, so the cleanup
reaches main only when someone merges it.

### Acceptance Criteria

#### Happy Path
- Given shipped stems with prunable files and no open `docs-prune/*` PR, when the operator runs `ai-conductor docs-prune`, then one PR is opened from branch `docs-prune/<date>` whose single commit deletes exactly the removable paths and changes no other path.
- Given that run, when the root checkout and the local `main` branch are inspected afterward, then `git status --porcelain` output and every tracked file are unchanged, local `main` points at the same commit, and no temporary worktree remains registered.
- Given the operator's own open `docs-prune/*` PR from an earlier run and newly shipped stems on `origin/main`, when the operator runs `ai-conductor docs-prune` again, then that same PR is refreshed to delete the current removable paths and no second PR is opened.

#### Negative Paths
- Given no shipped stem has a prunable file on `origin/main`, when the operator runs `ai-conductor docs-prune`, then no branch is pushed, no PR is created, and the command exits 0 reporting that nothing was pruned.
- Given a prune commit whose staged change would touch any path outside the removable set, when the commit is attempted, then the command refuses, pushes nothing, and exits non-zero naming the unexpected path.
- Given the guarded push of the `docs-prune/<date>` branch fails, when the command runs, then it exits non-zero naming the push failure, no PR is created, and `origin/main` is unchanged.
- Given any run of `ai-conductor docs-prune`, when the remote calls it made are inspected, then none pushes `main`, enables auto-merge, or merges a PR.
- Given an open `docs-prune/*` PR authored by a different operator, when the operator runs `ai-conductor docs-prune`, then it pushes nothing, leaves that PR unchanged, and exits non-zero naming that PR.
- Given the command runs inside an engine-dispatched session with `CONDUCT_DAEMON_SESSION` set, when it is invoked, then it is refused before any git or GitHub call and exits non-zero naming the blocked `docs-prune` subcommand.
- Given the operator declines the approval prompt for the branch push, or the terminal is non-interactive, when publication is reached, then nothing is pushed, no PR is created or edited, and the command exits non-zero naming the refused operation.
- Given the production source and the `.github/workflows` definitions, when every caller of the docs-prune deletion and publication path is enumerated, then the only caller is the `ai-conductor docs-prune` command dispatch, and no daemon tick, finish step, or CI workflow reaches it.

### Done When
- [ ] `ai-conductor docs-prune` is registered in the CLI command table and its `--help` describes the command.
- [ ] A real-git test with a mocked tracker shows the opened PR's diff contains only deletions of selected prunable paths.
- [ ] A rerun test shows exactly one open `docs-prune/*` PR after two runs.

---

## Story 3: Paths an open PR touches are deferred by whole stem

**Requirement:** ADR-3, RC-3

As an operator, I want any stem that open work still touches to be left alone, so merging the
cleanup never conflicts with a pushed branch.

### Acceptance Criteria

#### Happy Path
- Given shipped stem `alpha` and an open PR that modifies only `.docs/coherence/alpha.md`, when `docs-prune` runs, then no file of `alpha`'s prune set is removed and `alpha` is reported as deferred with reason `open-pr-modifies` naming that PR.
- Given an open PR that changes 150 files where the 150th is the plan file of shipped stem `alpha`, when `docs-prune` runs, then `alpha` is deferred with reason `open-pr-modifies`.
- Given shipped stems `alpha` and `gamma` where only `alpha` is touched by an open PR, when `docs-prune` runs, then every file of `gamma`'s prune set is removed and `alpha` is deferred.

#### Negative Paths
- Given the guarded tracker read of open PRs fails, when `docs-prune` runs, then it publishes nothing and exits non-zero naming the failed read.
- Given the open-PR file read returns a repeated cursor, when `docs-prune` runs, then it publishes nothing and exits non-zero naming the incomplete pagination.
- Given the open-PR file read returns a page that reports more files but supplies no next cursor, when `docs-prune` runs, then it publishes nothing and exits non-zero naming the incomplete pagination.
- Given the only open PR touching shipped stem `alpha` is this command's own `docs-prune/*` PR, when `docs-prune` runs again, then `alpha` is not deferred and its paths stay in the refreshed PR.

### Done When
- [ ] The open-PR changed-file read follows every PR and file cursor through the guarded tracker read, and the existing shipment audit's merged-PR read uses the same reader.
- [ ] Tests cover a PR with more than 100 changed files, a repeated cursor, and an incomplete page.

---

## Story 4: In-flight features survive a merged prune

**Requirement:** ADR-3, RC-2

As an operator, I want to merge the cleanup at any time, so I never have to wait for the daemon to
go idle.

### Acceptance Criteria

#### Happy Path
- Given an in-flight feature worktree with a protected-artifact seal covering the plan file of shipped stem `alpha`, which the feature never modified, when a docs-prune PR deleting that plan merges into `main` and the feature rebases onto it, then the seal verification passes without a HALT and the deleted path is pruned from the seal automatically.
- Given a merged docs-prune PR, when daemon discovery runs on the new `main`, then every pruned shipped stem is still treated as shipped and none is dispatched.

#### Negative Paths
- Given an in-flight feature with an unpushed local commit that edits `.docs/coherence/alpha.md` of shipped stem `alpha`, when a docs-prune PR deleting that file merges and the feature rebases, then the edit is not silently discarded: either the edited content is present on the branch after the rebase, or the rebase stops with a conflict that names `.docs/coherence/alpha.md`.
- Given a merged docs-prune PR that removed every prunable file of shipped stem `alpha`, when daemon discovery runs, then no unshipped stem adopts any of `alpha`'s former markers through undated-stem matching.

### Done When
- [ ] A real-git test drives a sealed in-flight feature through a merged prune and a rebase, and shows no HALT file and a seal without the deleted path.
- [ ] A discovery test over `main` before and after a prune shows the same eligible set.

---

## Story 5: Every cleanup reports what it removed and deferred

**Requirement:** ADR-5

As an operator, I want each cleanup to say exactly what it removed and what it left and why, so I
can review the PR and audit later runs.

### Acceptance Criteria

#### Happy Path
- Given a run that removes paths and defers a stem, when the opened PR body is read, then it lists every removed path and every deferred stem with its paths, its reason, and the PR that caused the deferral.
- Given that run, when the event log is read, then it holds exactly one `decide_artifacts_pruned` event carrying the removed paths, the deferred stems with their reasons, and the PR URL.

#### Negative Paths
- Given a run that has nothing to prune, when the event log is read, then the `decide_artifacts_pruned` event carries an empty removed list and no PR URL.
- Given a run that fails before publishing, when the event log is read, then no `decide_artifacts_pruned` event claims any path as removed.
- Given a deferral or skip, when its reason is read, then it is exactly `open-pr-modifies`, `no-shipped-record` or `malformed-manifest`, and the event type rejects any other value.

### Done When
- [ ] `decide_artifacts_pruned` is a member of the `ConductorEvent` union and is persisted by the existing event persister.
- [ ] No sidecar file or separate log is written by the command.

---

## Story 6: Repair and the shipment audit still work for pruned stems

**Requirement:** ADR-6

As an operator, I want shipment repair and the shipment audit to keep working after a cleanup, so
pruning never turns a healthy shipped record into an unexplained failure.

### Acceptance Criteria

#### Happy Path
- Given shipped stem `alpha` whose audit result was `aligned` before its plan was pruned, when `shipment-evidence audit` runs on `main` after the prune merges, then `alpha` is still reported `aligned`, using the plan from the parent of the commit that deleted it.
- Given shipped stem `alpha` whose plan was pruned and whose shipped record was later removed from `main`, when record-only repair rebuilds the record, then it produces the same record it would have produced before the prune.
- Given shipped stem `alpha` whose plan is still present at the commit being read, when the audit or repair reads it, then that present plan is used and no history lookup is made.

#### Negative Paths
- Given stem `alpha` whose plan is absent at the commit being read and was never deleted by any commit reachable from it, when record-only repair needs the plan, then it refuses with `shipment-plan-pruned` naming the `alpha` plan file, not the generic `plan … is unavailable`.
- Given a plan that exists only on an unmerged branch and is absent at the audit head, when `shipment-evidence audit` runs, then that row is classified `unresolved` with reason `shipment-plan-pruned` and every other row is still classified.
- Given stem `alpha` whose plan was deleted, re-added with new content, and deleted again, when the audit or repair needs the plan, then it uses the content from just before the most recent deletion.
- Given the git history read fails while looking up a pruned plan, when record-only repair or the audit needs that plan, then repair refuses with `shipment-plan-pruned` naming the path and the failed read, and the audit classifies that row `unresolved` with reason `shipment-plan-pruned` instead of `aligned`.

### Done When
- [ ] One shared pruned-plan lookup is used by both `expectedReconciledRecord` and the shipment audit's plan-presence check.
- [ ] A real-git test compares the audit report for a stem before and after its plan is pruned and shows the same result.
