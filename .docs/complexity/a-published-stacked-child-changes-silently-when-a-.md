# Complexity: A published stacked child changes silently when a routed fix lands in it (#3269)

Tier: L

Stacked-Delivery: approved

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | New durable refresh state for a routed round: per member, the expected and new tips, push receipt, and comment receipt. Two new lifecycle events on the existing spine |
| External integrations | New writes to GitHub: non-fast-forward pushes to already-published member branches, and PR comments on non-leaf member PRs |
| Auth / permission surface | The tip guard narrows publication ADR decision 11 for tips recorded by an applied restack. Member comments need a per-member target-bound guarded runner |
| State machines | FINISH gains a resumable refresh of already-published members, and leaf return re-pends `finish` on a published stack |
| Story count | ~8-12: admission past the freeze, operator landing, the guarded rewrite, ordered resumable refresh, tip mismatch, comment content, comment idempotency, no-comment cases, audit events, single-PR and unpublished parity |
| Files touched | ~15-25: `stack-tip-guard.ts`, `remote-git-operations.ts`, `push-lease.ts`, `stack-publication.ts`, `routing/round-admission.ts`, `routing/operator-round.ts`, `routing/routed-exit.ts`, `routing/route-types.ts`, `routing/route-record-store.ts`, `restack/restack-recovery.ts`, `restack/stack-preflight.ts`, `conductor.ts`, `pr-labels.ts`, `github-operations.ts`, `event-sinks.ts`, `types/events.ts` |
| ADR work | New `adr-2026-11-01-routed-fix-refreshes-a-published-stack`. Amends `adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 11, `adr-2026-10-12-routed-whole-feature-repair`, and `adr-2026-10-24-operator-route-round-for-closed-stacked-children` decisions 4 and 8 |

## Rationale

Large. This is the first engine write that rewrites a branch a human reviewer is already looking at, and a mistake silently replaces reviewed work on GitHub. It relaxes a fail-closed guard, adds a crash-resumable multi-member remote sequence, reopens a finished feature for dispatch, and amends three approved ADRs. Delivery is sliced by operator direction.
