# Complexity: Multi-branch restack for stacked child plans (#2943)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | A durable restack journal (cause, enumerated refs with old and new SHAs, per-child pre-image ranges); a restack-cause field on the rebase operation record; per-child cascade counters in the child ledger; recorded pushed tips for expected-SHA leases |
| External integrations | None new. It makes new use of git plumbing: first-parent `merge-tree --write-tree` plus `commit-tree` replay, and a multi-ref `update-ref --stdin` compare-and-swap transaction that covers branches and `refs/conductor/*` closure refs. Push leases change from bare to `--force-with-lease=<ref>:<sha>` |
| Auth / permission surface | Remote publication: the three existing push sites (`ship-draft-pr`, `autoresolve`, `halt-record`) refuse to overwrite an unrecorded remote tip. That deliberately changes N=1 push behaviour |
| State machines | The cursor and resume must read the journal before they judge divergence. Closure refs become movable by compare-and-swap. Re-kick lifts the non-leaf rebase skip. Rewind of a closed child is lifted. The FINISH `rebase` step becomes a stack refresh when children exist. `build_review` refunds become cause-scoped. Per-child gates are preserved or re-opened from a replay-identity proof |
| Story count | ~12–14: replay engine, tree-prediction verification, journal and atomic move, worktree sync and dirty refusal, conflict halt and resolver hand-off, halt-record commits, fresh-base refresh at FINISH, cause and refund scoping, cascade cap, re-kick, rewind and interrupted recovery, per-child re-validation, expected-SHA leases, events, N=1 parity |
| Files touched | ~25–35 engine modules: `rebase.ts`, `rebase-translate.ts`, `rebase-replay.ts`, `rebase-transition.ts`, `child-cursor.ts`, `child-lifecycle.ts`, `daemon-rekick.ts`, `rewind.ts`, `conductor.ts`, `gate-verdicts.ts`, `kickback-ledger.ts`, `ship-draft-pr.ts`, `autoresolve.ts`, `halt-record.ts`, `types/events.ts`, plus new restack modules, the runbook and the drift-audit and golden tests |
| ADR work | Amends `adr-2026-10-07-per-child-build-region` (D1, D11, D12), `adr-2026-10-03-stacked-child-plans-identity-and-state`, `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history` D1, `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` D2, `adr-2026-07-23-build-review-fresh-base-disposition`, `adr-2026-09-11-selective-post-rebase-verification` and `adr-2026-07-03-post-rebase-force-with-lease`. A new ADR covers the restack primitive and journal |

## Rationale

Large. This is a new git-history-rewriting engine over several branches and engine-owned refs, where
one bug silently loses or corrupts committed work. It must be crash-safe across a multi-ref move, and
it changes the authority model of closure refs that the cursor, base resolver and FINISH fence all
depend on. It also changes refund and cap accounting on the `build_review` convergence bound, and it
alters remote push semantics for every feature, N=1 included. The blast radius, the number of ADR
amendments and the need for empirical git-behaviour tests all put it at L, so it needs a full
architecture review.
