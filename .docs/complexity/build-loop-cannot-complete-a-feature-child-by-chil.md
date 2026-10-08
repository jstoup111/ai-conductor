# Complexity: Per-child BUILD region for stacked features (#2942)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | An active-child cursor derived from git, monotone closure refs under `refs/conductor/<slug>/closed/c<k>`, a recorded child for each remediation task, and an overlay of flat and per-child conduct state |
| External integrations | None new. The git ref layout gains engine-owned closure refs, and child branches are created and switched for the first time |
| Auth / permission surface | Commit-msg hook gains a blocking task-membership check bound to the checked-out ref. Halt-record and build-failure escalation must never push a child branch |
| State machines | The BUILD region becomes per-child: the selector, resume, gate caps, kickback ledger, stall detection and stale cascades all read and write through the active child. The FINISH rebase and resume rebase gain stacked guards |
| Story count | ~16: cursor and closure, child creation and switch, leaf move, rebase guards, overlay state and mutation port, per-child acceptance, per-child build and stall, per-child test_suite and FINISH readers, per-child build_review base and binding, security at the leaf, per-child caps and ledger, commit-hook membership, recovery CLIs and rewind refusal, halt records, events and status, position immutability, and the flag consumer with N=1 parity |
| Files touched | ~45–60 engine modules (`conductor.ts`, `selector.ts`, `resume.ts`, `artifacts.ts`, `build-review-*`, `full-suite-*`, `kickback-ledger.ts`, `rebase*.ts`, `daemon-rekick.ts`, `git-hook-assets.ts`, `halt-*`, `step-runners.ts`, `types/events.ts`, `event-sinks.ts`), the `writing-system-tests` skill, runbooks and CLI reference |
| ADR work | Amends the umbrella ADR (D8, D9, D10, D11, follow-ups) and seven or more approved ADRs (acceptance RED lifecycle, rubric container, Done-when binding, test-suite verification mode, trailer routing, cumulative build_review bound, verdict-aware resume, cross-dispatch livelock bound) |

## Rationale

This feature turns the #3019 storage foundation into a running per-child build loop. It touches the
engine's hottest paths: selector, resume, gate caps, every kickback-ledger caller, acceptance
evidence, build_review inputs and the commit hooks. It is also the first code that creates, switches
and moves branches inside a feature worktree. A mistake either regresses every N=1 feature or
corrupts a stack in ways the restack ticket cannot repair. It amends many approved ADRs, and three
adversarial reviews found blockers in the first draft. That warrants the full architecture review,
a conflict-check and a coherence-check. → **Large.**

Stacked-Delivery: not requested (this feature is delivered as a single PR).
