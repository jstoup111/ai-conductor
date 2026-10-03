# Architecture Review: git-side veto for ref-moving destructive git that bypasses the build guard (#2693)

**Date:** 2026-10-03
**Mode:** Lightweight (Medium tier): Technical Feasibility and Architectural Alignment
**Input:** `.docs/track/ref-moving-destructive-git-that-bypasses-the-build.md` (technical track; operator-confirmed scope), `.docs/architecture/ref-moving-destructive-git-that-bypasses-the-build.md` (approved 2026-10-03)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All git-semantics claims below were observed on git 2.53.0 in scratch repositories on 2026-10-03 (verified, about 95%):

- A `reference-transaction` hook that exits non-zero at `prepared` aborts a branch deletion and leaves the ref unchanged (`fatal: ref updates aborted by hook`).
- `git branch -D` passes an all-zero old value. `git rev-parse` of the ref still returns its tip inside the hook, so the hook resolves the value itself.
- `git pack-refs --all` and `git gc` delete each loose `refs/heads/*` ref through a `reference-transaction` with a real old value, after `packed-refs` already holds the same value. A naive deletion veto breaks both; under `gc` the failure is silent (`error: failed to run pack-refs`, exit 0). D12's loose-ref-prune rule exists for this.
- `git branch -m` deletes the old name with the new name not yet visible to the hook, so renaming a branch whose tip no other ref holds is indistinguishable from deleting it. Accepted as a refusal with a named alternative.
- `pre-push` receives the remote's real current value for each ref. With a fresh tracking ref and a bare `--force-with-lease`, that value equals the tracking ref. With an explicit lease against a stale tracking ref, it differs.
- Git withholds updates it has already rejected locally (plain non-fast-forward, failed lease) from `pre-push`. The hook never changes the stderr that engine code sees for an ordinary rejected push.

Stack: no new dependency, service, schema or migration. The two hooks are bash assets on the existing channel.

Prerequisites: none. #2895 and #2904 are not dependencies: the hooks see ref values, not argv, and fire for every provider.

Integration surface, verified by a source survey on main @ `fd6f539ca`:

- `git-hook-assets.ts`: two new exported string constants.
- `worktree-prepare.ts` `writeGitHooks`: two more write and chmod pairs.
- `git-guard.ts` `ensureGitGuardForDispatch`: re-verifies the two hooks.
- `docs/reference/settings-and-hooks.md`: the hook table says "three git hooks" and must list five; the control inventory needs the new limits.

Performance: `reference-transaction` runs for every ref transaction, including each commit. The fast path is one bash start that reads stdin and exits with no git call. Git calls happen only for a `refs/heads/*` deletion.

Worktree isolation: the hooks live under the worktree's `.pipeline/`, a live-boundary volatile prefix (adr-2026-08-17-structural-live-checkout-containment), and write nothing. Parallel worktrees share nothing new.

## Alignment

Governing ADR: adr-2026-09-23-engine-git-guard-on-agent-path. It names this backstop as its #2693 follow-up, so it is amended (D7 and D10 notes, new D11 to D15) instead of drafting a new ADR, per the reuse check.

A repo-wide sweep read the Decision section of all 328 ADRs. Findings and their resolution:

| ADR | Finding | Resolution |
|---|---|---|
| engine-git-guard-on-agent-path D7 | "unaffected by construction" assumed `PATH` was the only channel | Additive D7 note plus D14 |
| inline-work-attribution-enforcement, "Fail-open provisioning" | Says hook installation fails open | Already superseded in code and by provider-neutral-commit-gate D3: `writeGitHooksAndWire` throws "preventive git hook installation failed". D11 cites this. |
| deterministic-evidence-attribution-enforcement D2 | Engine hooks must chain to `$GIT_COMMON_DIR/hooks/«name»` | D11 requires chaining after the hook's own allow |
| ancestry-proven-park-reconciliation D3/D4, multi-proof-park-deletion-authority D1/D9, defer-feature-worktree-reap D3 | Squash-merged branch tips are unreachable from every ref, so the hook would refuse those deletions if they ran under a feature worktree's config | Verified that they run in the root checkout (`worktree.ts:112`, `park-reconciliation.ts:1100`). D14 makes that a constraint. |
| post-rebase-force-with-lease D1, widen-rebase-resolution D1, automatic-rebase-flattens D1/D4, rebase-tail D2–D7, autoresolve-state | Lease publication must keep passing | Every engine lease is a bare `--force-with-lease` (`autoresolve.ts:772`, `ship-draft-pr.ts:397`). A successful bare lease always has the tracking ref equal to the remote value, so D13 passes it by construction. |
| provider-neutral-commit-gate D2 | `CONDUCT_ENGINE_COMMIT` is the engine-bookkeeping escape | Stays commit-only. The new hooks do not read it (D14). |
| setup-failure-triage D2 (quarantine) | `wip/setup-quarantine-«slug»` is force-moved and unreachable by design | A force-move is an update, so it passes. Nothing in the engine deletes the ref. The hook protects it from agents. |
| session-hook-repair-before-halt, pipeline-state-durability | A recreated `.pipeline` leaves `core.hooksPath` pointing at no hooks | D14 extends the D3 pre-dispatch re-verify to the two hooks |
| hook-owned-containment-event-ledger, event-spine family | Refusal telemetry would need a `ConductorEvent` variant, not a sidecar | Out of scope, matching #1354's operator decision. Stderr only. No new channel. |
| github-operation-ownership D9 | Bot pushes inject a child-only credential | `pre-push` reads stdin and local refs only (D13) |
| operator-launched-sessions D5 | Guided recovery sessions use the halted worktree as cwd | D14: delete squash-merged branches from the root checkout |
| non-blocking-plan-scope-containment D3, semantic-attribution-verification-lane D9 | Commit hooks gain no exit-1 branch; the attribution lane gains no enforcement | Untouched. These are new ref-safety hooks, not attribution machinery. |

Focused local pattern basis:

- **Role.** An embedded preventive hook asset written by `writeGitHooks`.
- **Traits to preserve:**
  - a static exported string constant in `git-hook-assets.ts`;
  - pure bash, no runtime data expanded into interpreter source;
  - written at mode 0755 into `.pipeline/git-hooks/` through fail-closed provisioning;
  - chains to the common hook when present.
- **Why it applies.** The new hooks share the channel, the provisioning and the inventory.
- **Allowed variation.** The new hooks refuse on positive evidence, unlike the attribution hooks.
- **Rediscovery hints.** `PRE_COMMIT_HOOK` and `COMMIT_MSG_HOOK` in `src/conductor/src/engine/git-hook-assets.ts`, `writeGitHooks` in `src/conductor/src/engine/worktree-prepare.ts`, `ensureGitGuardForDispatch` in `src/conductor/src/engine/git-guard.ts`.

Security boundary: these hooks guard against accidents, not adversaries. `git -c core.hooksPath=…`, `git push --no-verify`, and git run from the root checkout or a worktree the engine did not prepare all get past them. They are recorded limits (D15). #1352 remains the stronger control.

## Wiring Surface

| New production surface | Called from in production |
|---|---|
| `REFERENCE_TRANSACTION_HOOK` and `PRE_PUSH_HOOK` constants | Written by the existing `writeGitHooks`, called from `prepareWorktree` → `writeGitHooksAndWire` on every feature and resolve worktree preparation |
| `«worktree»/.pipeline/git-hooks/reference-transaction` | Invoked by git through the worktree-scoped `core.hooksPath` that `wireGitHooks` already sets, on every ref transaction in that worktree |
| `«worktree»/.pipeline/git-hooks/pre-push` | Invoked by git through the same `core.hooksPath` on every push from that worktree |
| Hook re-verification | The existing `ensureGitGuardForDispatch`, already called from the Claude and Codex provider adapters before each guarded dispatch |

The advisory overlap scan over `git-hook-assets.ts`, `worktree-prepare.ts`, `git-guard.ts` and `docs/reference/settings-and-hooks.md` reported no overlap and no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A ref-deleting git maintenance path other than `pack-refs`/`gc` is refused, silently degrading maintenance | Technical | Low | Medium | D15 tests `pack-refs --all` and `gc`. The prune rule is generic to loose-copy removal. |
| A future engine change runs a branch deletion or explicit-value lease from a feature worktree and is refused | Integration | Low | High | D14 states the constraint. A test exercises the engine's ref operations under the hooks. A refusal is loud (non-zero exit with a named reason), not silent. |
| `reference-transaction` start-up cost on every commit slows builds | Performance | Low | Low | Fast path with no git call |
| A non-default fetch refspec makes the tracking ref unresolvable, so a legitimate lease push is refused | Technical | Low | Medium | Fail-closed by design. The refusal names fetching and pushing with a bare lease. The engine and consumers use the default mapping. |
| Under the reftable backend there are no loose refs; the prune rule never applies | Technical | Low | Low | The reachability rule still governs deletions. The plan should add a reftable test when the local git supports it. |

## ADRs Created

None. adr-2026-09-23-engine-git-guard-on-agent-path is amended additively:

- a D7 note;
- a D10 note;
- new decisions D11 to D15 under `## Decision`, each marked `Amended 2026-10-03 by #2693 (operator decision)`.

The amendment needs operator approval before landing.

## Conditions

1. The plan carries one Architecture Obligation Coverage row for each citable decision the land gate demands from the amended ADR, D11 to D15 at minimum.
2. Tests follow the repository's test-process-isolation rule: temporary repositories and a local bare remote only; never the live checkout or a real remote.
3. `docs/reference/settings-and-hooks.md` lists all five worktree hooks and adds the D15 limits to the control inventory.
