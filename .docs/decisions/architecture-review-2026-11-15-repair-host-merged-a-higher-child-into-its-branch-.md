# Architecture Review: Repair host merged a higher child into its branch; no guard refused it (#3676)
**Date:** 2026-11-15
**Inputs reviewed:** explore output and the technical intent in `.docs/track/repair-host-merged-a-higher-child-into-its-branch-.md`; Tier M from `.docs/complexity/repair-host-merged-a-higher-child-into-its-branch-.md`; the approved component diagram `.docs/architecture/repair-host-merged-a-higher-child-into-its-branch-.md`
**Mode:** lightweight (Medium). Sections 2 and 4 only.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Intent | Assessment |
|---|---|
| A refusal at commit time for every way child `k`'s tip can move | **Feasible.** Verified on git 2.53 (2026-11-15): a `reference-transaction` `prepared` veto refuses a fast-forward merge, `reset --keep`, and the commit after `merge --no-commit`. Git does update the index and worktree before that stage. `git reset --merge HEAD` and `git merge --abort` restore them, and the matrix allows both. The wrapper (`engine/git-guard.ts`, `GIT_GUARD_SCRIPT`) already classifies argv before running git. It can resolve the incoming commits with read-only `rev-list`, which `adr-2026-09-23-engine-git-guard-on-agent-path` D6's 2026-09-28 amendment permits. |
| Patch-id detection of copied commits | **Feasible at the gates.** `git cherry` semantics against the closure of the child below each higher child give that child's own patches. This is too costly per ref update, so it runs only at the gates (ADR decision 1). The wrapper checks cherry-pick arguments by identity, which is exact and cheap. |
| A gate backstop that names the cause | **Feasible.** The routed host gates run in the conductor process. `requestRoutedExit` (`engine/routing/routed-exit.ts`) is the exit point. The existing needs-human HALT path emits `halt_record_written`. |
| Normal repair commits and restack replays unaffected | **Feasible without a bypass variable.** `CONDUCT_ENGINE_COMMIT` is commit-only (`engine/rebase.ts` sets it only when `args[0] === 'commit'`), and D14 of the guard ADR forbids an escape variable. Engine ref moves inside a feature worktree run the worktree's hooks (D7's 2026-10-03 amendment). They pass because none gains a higher-unique commit (assumption A2 of the new ADR). |

**Stack compatibility:** no new dependency. It uses git plumbing already in use: `rev-list`, `merge-base`, `cherry`, `patch-id`.
**Prerequisites:** #3653 (blocked-by). It changes `stack-commit-guard` for leaf-executed audit rounds and adds the fold. This design relies on the fold's single-transaction move (fold ADR decision 8).
**Integration surface:**
- the guard asset;
- the hook assets;
- one new internal launcher subcommand;
- one engine predicate module;
- the conductor's step dispatch for `test_suite` and `build_review`;
- the routed exit.

These are four seams, all inside the engine.
**Data implications:** none. It reads existing refs (`feat/c«k»/«slug»`, `refs/conductor/«slug»/closed/c«k»`) and durable child state. No persisted format changes.
**Performance:** one engine CLI process per child-branch ref update. Other refs pay nothing new. Patch mode runs once per gate dispatch.
**Worktree isolation:** hooks and the wrapper are per worktree already (`core.hooksPath --worktree`). Nothing shared is added.

## Alignment

- **The guard ADR (`adr-2026-09-23-engine-git-guard-on-agent-path`).** The design extends its two-layer model, the wrapper as primary and the git-side hooks as backstop (D11). It keeps the no-bypass rule (D7, D14) and the self-explaining refusal (D6). Two assertions are falsified and amended in place:
  - D5's matrix gains a containment class;
  - D12's "every other line passes with no git call" now excludes child-branch updates.
- **Fail-closed option parsing (`adr-2026-10-03-fail-closed-git-option-normalization`).** The new wrapper class uses the shared option spec, and on a child branch an unresolved option is refused.
- **Routed repair (`adr-2026-10-12-routed-whole-feature-repair`).** The design is consistent with:
  - D5: a reroute resets a host to its closure, which the predicate passes;
  - D9: routed tasks are appended on the host branch, which are ordinary commits;
  - D13: exit restack.

  No decision there permits a host to contain a higher child. This makes the implicit invariant explicit.
- **The fold (`adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish`).** The design composes with it:
  - leaf-executed hosts commit on the top position, which is out of scope;
  - fold-placed commits are new SHAs moved in one transaction (D8), so identity mode passes and patch mode sees no stale copy (assumption A3).
- **Operator rounds (`adr-2026-10-24-operator-route-round-for-closed-stacked-children`).** Not affected. Operator recovery runs from the root checkout, which has no worktree hooks.
- **The event spine.** No new channel. A hook refusal is a separate git process (exception A), and it stays on stderr like every worktree hook. The occurrence consumers need, a gate refusal, rides `halt_record_written`.
- **State.** The verdict is a discriminated union (`contained` or `foreign` with child and commits), not a boolean. The HALT reason is a new member of the existing reason set.
- **Security.** Agents cannot bypass the check with an environment variable. The remaining limits are the recorded ones from the guard ADR's D15: `git -c core.hooksPath=…`, root-checkout git. The gate backstop covers them.
- **Diagrams.** The approved component diagram was revised in place during this review: the engine exemption node became a no-bypass node, and the new event variant became the existing halt event. It renders.

**Focused local pattern basis.** The hook-to-engine-CLI call copies the pre-commit `stack-commit-guard` invocation in `engine/git-hook-assets.ts` (symbol `PRE_COMMIT_HOOK`, the `launcher` variable). Its traits:
- a launcher path baked at hook-write time;
- a fixed subcommand with no runtime data expanded into the hook source;
- non-zero exit refuses the operation.

Variation allowed: `reference-transaction` passes the old and new values from stdin as arguments.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| Stack-containment predicate module (engine) | Called by the new launcher subcommand and in-process by the conductor's gate check |
| Launcher subcommand (`stack-containment-check`, internal) | Invoked by the guard asset's containment class and by the `reference-transaction` hook asset, both written by `prepareWorktree` / `writeGitGuard` and re-verified before every guarded dispatch |
| Wrapper containment class | `GIT_GUARD_SCRIPT` on the agent `PATH` for every provider adapter (guard ADR D2) |
| `reference-transaction` child-branch check | The existing hook, wired through `core.hooksPath` by `engine/worktree-prepare.ts` |
| Gate pre-dispatch check | The conductor's dispatch of `test_suite` and `build_review` for a stacked child below the top |
| Routed-exit check | `requestRoutedExit` in `engine/routing/routed-exit.ts` |
| HALT reason `stack-containment-violated` | The existing needs-human HALT writer, then `halt_record_written` |

Overlap scan (advisory, 2026-11-15):
- `conductor.ts` overlaps seven open spec branches;
- `routing/routed-exit.ts` overlaps `spec/routed-round-advance-carries-the-previous-host-s-e`;
- the hook and guard assets overlap open PRs #3684 (#3653's build, already a blocker) and #3530 (draft).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| An engine ref move inside a feature worktree gains a higher-unique commit and is refused | Technical | Low | High | Real-git proofs over every engine operation in decision 4 (ADR decision 7); A2 approval |
| Patch mode raises a false positive after a fold or restack | Technical | Low | High | Gate check uses closures and `git cherry` semantics; A3 approval; the HALT names commits so a false positive is diagnosable |
| A builder with a real missing prerequisite now fails its attempt instead of improvising | Integration | Medium | Medium | Intended. #3653 removes the audit-round trigger, and #3674 owns claim ergonomics |
| Child-branch commit latency | Performance | Medium | Low | Only child-branch lines pay; A5 |
| A conflict with #3653 in the stack-commit guard and hook assets | Integration | High | Medium | Blocked-by #3653 |

## ADRs Created

- `adr-2026-11-15-stack-children-never-gain-higher-child-commits` (APPROVED pending operator confirmation of A2–A4). This is a new structural decision: a durable invariant on child-branch state, plus how it is enforced across the guard, the hooks and the gates.
- Amended in place: `adr-2026-09-23-engine-git-guard-on-agent-path` D5 and D12.

## Amendment pass (conflict-check, 2026-11-15)

The conflict check found three blocking conflicts against the first definition, which counted every commit reachable from a higher branch:

- child-branch creation was refused, because a creation line has an all-zero old value;
- every first-pass child gate halted, because the leaf exists before it is entered;
- leaf-executed audit hosts halted.

Resolved with operator approval. A higher child counts only once it is entered (its predecessor position has closed), and then only its own range (`feat/c«j» ^closed/c«p» ^origin/«default»`, where `p` is the predecessor position, because positions may have gaps). The re-check findings N1 (default-branch merges) and N2 (gapped positions) were fixed the same way. The check keys on `feat/c«k»` branches, so the leaf is never checked. ADR decisions 1, 2, 5 and 7 and assumption A4 were revised; A6 was added.

C4 was also resolved: `adr-2026-10-03-fail-closed-git-option-normalization` is amended so that `merge`, `cherry-pick` and `rebase` are guarded only on child branches.

## Conditions

1. #3653 merges before this spec builds (blocked-by edge at land).
2. The plan carries a real-git proof for every engine ref operation listed in ADR decision 4 before the hook check is enabled.
3. The plan's obligation table covers every decision of the amended `adr-2026-09-23-engine-git-guard-on-agent-path` and `adr-2026-10-03-fail-closed-git-option-normalization`, not only the amended ones.
