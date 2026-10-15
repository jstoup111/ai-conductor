# Complexity: Place admitted whole-feature fixes in the owning stacked child (#3210)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None new: the route record, marker and queue types shipped with #2944. New producers: route-record creation, host transitions and event outbox entries; an engine-owned residue routing call with its own schema and retry budget |
| External integrations | None. New git plumbing use: create-only and multi-ref `update-ref --stdin` compare-and-swap transactions (route record plus marker) and `ls-tree` presence checks over closure refs |
| Auth / permission surface | None changed in this spec (the execution projection in the membership hook and `task-cli` moves to #3211) |
| State machines | Round phase `prepared` → `open` and host `pending` → `admitted` are written for the first time; resume reconciliation by the ADR phase table; the stack preflight skips the automatic `feature-repair` restack while a marker exists and defers base refresh while a round is open |
| Story count | ~6: classification first and N=1 untouched, task-bound owners, residue routing and mixed rounds, cannot-host placement, marker-first admission and crash recovery, routing events |
| Files touched | ~12–16: `conductor.ts` (`planRemediation`), new `routing/{owner-derivation,cannot-host,residue-routing-call,round-router,round-admission,routing-events}.ts`, `routing/route-record-store.ts`, `step-runner-types.ts`, `step-runners.ts`, `restack/stack-preflight.ts`, `daemon-rekick.ts`, `daemon-cli.ts`, plus tests |
| ADR work | Implements the approved `adr-2026-10-12-routed-whole-feature-repair` decisions 1–4, 7 and the writers of 6 and 16. The open contradiction findings carried from the split may require a bounded amendment to decision 6's phase table and decision 6's writer fence |

## Rationale

Large. This is the first spec that writes routing state: it creates durable route records, writes
the repair marker, and changes when the stack preflight may move closure refs. An ordering mistake
silently loses a round, duplicates one, or lets the automatic restack close over a half-built fix.
It also adds an LLM judgement on the remediation path, which must fail closed without charging
gate laps. Routing stays behind the default-off setting, but the crash-recovery matrix and the
open contradiction findings from the #2944 split need a full architecture review.
