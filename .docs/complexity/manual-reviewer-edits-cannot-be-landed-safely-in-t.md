# Complexity: Land manual changes in the stacked child that owns them, and rewind closed children (#3203)

Tier: L
Stacked-Delivery: approved

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | A third route kind (`operator`, with origin `land` or `rewind`) in the route record, its parser, and every kind branch point. A declared-complete marker on the host. A new `--done` exit path out of the host region |
| External integrations | None. New git plumbing is limited to the existing `writeRoutingTransaction` op list and a hook refusal |
| Auth / permission surface | A new guarded operator CLI (`ai-conductor stack land`). It needs mechanical preconditions: operator park, no published stack, closed target, no open round, queue or restack journal |
| State machines | Host `admitted`→`repairing`→`built`/`done` for a round with no provider build until the declaration. The preflight gains a halt for an undeclared operator round. Abandon resets a branch to its closure. Each step must recover from a crash between transactions |
| Story count | ~6: start a landing; refuse wrong-child commits; never close over an undeclared change; declare done and re-validate; abandon; closed-child rewind |
| Files touched | ~20: `routing/{route-types,route-record-store,round-admission,host-region-entry,routed-exit,revalidation-queue}.ts`, `child-cursor.ts`, `restack/stack-preflight.ts`, `rewind.ts`, `conductor.ts`, `git-hook-assets.ts`, `task-membership-check-cli.ts` or a new hook CLI, `cli.ts`, `cli-pre-dispatch.ts`, a new `stack-land-cli.ts`, a new shipped skill, `docs/reference/{cli,configuration}.md`, `docs/runbooks/stalled-or-stuck-feature.md`, plus tests |
| ADR work | A new ADR for the operator round kind, its preconditions and exclusion, and amendments to `adr-2026-10-12-routed-whole-feature-repair` (decisions 6, 7, 8, 13) and to the rewind refusal |

## Rationale

Large. The change adds a third producer to a crash-safe, ref-backed state machine that four specs
built and that has no slack: only one of the kind branch points fails at compile time, and the
others silently treat a new kind as `revalidate`. It also introduces a long-lived round that is
open while a human edits a branch, which the existing machinery never models: every shipped round
moves straight into a provider build. Getting the hook refusal, the preflight halt, the declaration
and the abandon right across crashes needs a full architecture review. It is a consumer-facing
operator CLI and shipped skill, so it carries documentation and a skill. After adversarial review
added a per-feature dispatch lease, a token-owned park and the retirement of automatic close-over,
the estimate is 28–30 plan tasks. The operator declined a split on 2026-10-24, so the plan carries a
scope exception (`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decision 19). It depends on #3365, which re-sources the
cursor, the commit hook and `rewind` through its slice-topology loader.

Per tier rules: architecture-diagram, full architecture-review, conflict-check, and coherence-check
apply; no PRD (technical track).
