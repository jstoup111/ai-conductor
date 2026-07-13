# Conflict-check: rekick-resume-republish-stale-worktree-engine

**Source:** jstoup111/ai-conductor#625 · **Track:** technical · **Tier:** S
**Result:** PASS (0 blocking; sequencing notes only)

This feature adds one self-host-gated republish step to the re-kick resume path, bound to a
`'rebased'` outcome, reusing the existing content-addressed publish. It reads/writes no
evidence, attribution, task-status, or trailer surface — blast radius is the resume path.

## Internal consistency (this spec's stories)

No contradictions. Story 1 (republish on engine-touching rebase), Story 2 (no-op on
noop/non-engine), Story 3 (skip on non-self-host), Story 4 (fail-closed on build failure),
Story 5 (bind to a single `'rebased'` outcome) partition cleanly on outcome-kind, self-host
flag, and build result. The only state change is flipping the worktree `dist` symlink via the
existing atomic `flipCurrent` — monotonic, no torn state.

## Cross-feature conflicts

| # | Overlapping work | Surface | Nature | Resolution |
|---|---|---|---|---|
| C1 | **#598** daemon's own stale engine after merge | conceptual sibling; `rebuildEngineFromSource` reuse | Complementary, different engine (daemon process vs worktree `dist`). | No conflict. This fix reuses `rebuildEngineFromSource` as a primitive but points it at the worktree's `src/conductor`; it does not alter #598's daemon-restart pipeline. If #598 lands a fix in the same helper, re-assert the helper signature after it merges. |
| C2 | **#532** verdict-aware resume | `resumeRebaseFirst` / `runConductorInWorktree` | Adjacent: #532 clamps resume start index; this adds a republish after `resumeRebaseFirst` returns. | Orthogonal (start-index vs post-rebase republish). Sequencing only: rebase on latest main and re-assert the `resumeRebaseFirst` call site (`daemon-cli.ts` ~779) if #532 is unmerged. |
| C3 | **#535** rebase-evidence-translation | `performRebase` / post-rebase step | Both act post-rebase. | No conflict: #535 translates sha-anchored evidence stores; this rebuilds the engine artifact. Disjoint targets. Ordering-agnostic — the republish neither reads nor writes evidence. |
| C4 | **#280** progress-aware build halt (PR #601) | build halt/park decision | The stale-engine `0/0` misparse triggered a "retries exhausted" halt. | Complementary: #280 changes WHEN to halt on progress; this removes the stale-engine CAUSE of the `0/0` misparse. No shared code — #280 is in the halt decision, this is in the resume republish. |

## Resource / state contention

- **Worktree `dist` symlink + `dist-versions/`** — the sole writer during the resume step is
  the republish (single-threaded per feature in the daemon loop). `flipCurrent` is atomic
  (build to staging → rename). The daemon runs its own engine from its OWN pinned
  `dist-versions/<id>` (`rebuildEngineFromSource` docstring: the running daemon is never
  disturbed), so republishing the worktree's `dist` cannot ENOENT-crash the daemon.
- **No `.pipeline` evidence stores touched** — no contention with the gate loop's writers.

## Sequencing recommendation

Independent — mergeable on current `origin/main` (e01081c0). No blocking dependency on
#532/#535/#598/#280. If any land first and touch `resumeRebaseFirst` / `rebuildEngineFromSource`
signatures, re-assert those two anchors before implementation.
