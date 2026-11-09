# Conflict Check: Routed residue finding lands on a taskless host and halts the stack (#3590)

**Date:** 2026-11-05
**Stories checked:** `.docs/stories/routed-residue-finding-lands-on-a-taskless-host-an.md` (Stories 1–3), and the in-place change to Story 1 of `.docs/stories/a-routed-fix-cannot-be-built-charged-and-reviewed-.md` (the no-op guard criterion), against all of `.docs/stories/`
**Result:** PASSED — 0 blocking, 0 degrading

## ADR corpus

- **Examined (subject overlaps these stories):** `adr-2026-10-12-routed-whole-feature-repair` (decisions 2, 3, 6, 7, 10, 16, as amended by #3590), `adr-2026-07-13-kickback-build-no-op-escalation` (D1, as amended by #3211, #3203 and #3590), `adr-2026-09-06-reopened-task-resolution`, `adr-2026-10-24-operator-route-round-for-closed-stacked-children`.
- **Narrowed out:** every other approved ADR in `.docs/decisions/`. None governs residue owner classification, routed host entry, the routed no-op guard, or the routed exit.

## Pairs examined (both directions)

| New story | Existing story | Shared surface | Verdict |
|---|---|---|---|
| Story 1 | `admitted-whole-feature-fixes-in-a-stacked-feature-` Story 3 (residue routing call) | Residue classification and `residue-default` | Compatible. Its ADR-citing example carries no existing-task binding; #3590 Story 1's negative path keeps `residue-default` for unbound residue |
| Story 1 | `admitted-whole-feature-fixes-in-a-stacked-feature-` Story 3 (mixed round) | Mixed-round FAIL host | Compatible. The FAIL host is still the lowest task-bound host; the reclassified item is now task-bound |
| Story 2 | `a-routed-fix-cannot-be-built-charged-and-reviewed-` Story 1 (no-op guard criterion) | Routed no-op guard outcome | Was a contradiction (unconditional halt); resolved in DECIDE by narrowing that accepted criterion in place to rounds with no pending, restacked or rerouted host. Each now holds when the other is satisfied |
| Story 2 | `a-routed-fix-cannot-be-built-charged-and-reviewed-` Story 1 (`repairing` only after the append commit) | Host transition order | Compatible. The settle enters `repairing` after region entry's writes |
| Story 2 | `a-routed-fix-cannot-be-built-charged-and-reviewed-` Story 7 (credit flag) | `routed_repair_phase.credit` | Compatible. Story 7 applies only when credit is granted; a settle grants none and emits `credit: false` |
| Story 2 | `admitted-whole-feature-fixes-in-a-stacked-feature-` (event literals only in the routing event module) | `routed_repair_phase` construction | Compatible, and binding on the plan: the `reason` field must be set through `routing-events.ts` |
| Story 2 | `kickback-to-build-no-op-when-target-evidence-stamped` Story 2 | No-op halt | Compatible. That story governs `planRemediation` for N=1; for a stacked round it defers to the host-entry guard, now narrowed by ADR amendment |
| Story 3 | `operator-command-to-inspect-and-recover-wedged-rou` | Operator recovery of a stuck round | Compatible. No new command; `stack rounds` stays read-only |

No oscillating pair was found: satisfying #3590 Story 2's settle never re-triggers the narrowed halt criterion, and the reverse does not hold either.
