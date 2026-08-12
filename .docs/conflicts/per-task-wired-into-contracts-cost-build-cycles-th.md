# Conflict Check: Move wiring judgement into build_review

**Date:** 2026-08-11
**Issue:** jstoup111/ai-conductor#1496
**Stories checked:** `.docs/stories/per-task-wired-into-contracts-cost-build-cycles-th.md` (7)
**Scope:** all 5 conflict types, intra-feature pairs, and 8 named adjacent areas
**Result:** 1 blocking (resolved), 2 degrading (accepted), 5 adjacent areas verified clean

---

## Conflict: The judgement needs entry points the deletion removes

**Stories involved:** *Story ST-1496-1 — build_review judges wiring reachability* vs *Story ST-1496-4 — the wiring
machinery is deleted without residue*
**Files:** `.docs/stories/per-task-wired-into-contracts-cost-build-cycles-th.md` vs
`src/conductor/src/engine/wiring-probe.ts:862-894` (`resolveLayer2Applicability`),
`src/conductor/src/types/config.ts:619-627` (`WiringConfig`), `.ai-conductor/config.yml:63-68`
**Type:** state-conflict
**Severity:** blocking

**Description:**
Story 1 requires the grader to judge whether new surface is "called from a path reaching a
**configured production entry point**." The only definition of a production entry point in this
system is `config.wiring.entry_points`, and its sole consumer is `resolveLayer2Applicability`
(`wiring-probe.ts:874`) — a function inside the module Story 4 deletes outright.

Taken together the two stories are individually satisfiable but mutually exclusive: satisfy Story 4
by deleting `wiring-probe.ts` and the `wiring.entry_points` key loses its only reader, leaving
Story 1's "configured production entry point" undefined. Satisfy Story 1 by keeping the resolver and
Story 4's "no residue" fails.

This is not hypothetical for this repository: `.ai-conductor/config.yml:63-68` curates four explicit
roots, with a comment recording that `daemon-cli.ts`, `intake-loop-cli.ts`, and `engineer-cli.ts` are
listed explicitly as **defense-in-depth** even though `index.ts` reaches all three transitively. That
curation is operator knowledge a grader cannot reliably infer by reading the repo — an LLM asked to
guess entry points would likely nominate `index.ts` alone and miss the lazy
`await import('./daemon-cli.js')` edge the comment exists to protect.

**Resolution (selected):** **Retain `WiringConfig.entry_points` as configuration and render it into
`build_review`'s prompt.** The config key, its schema, and this repo's four curated roots survive the
change; what is deleted is the import-graph walk that consumed them, not the declaration of what
counts as production. The grader is told the entry points explicitly rather than inferring them.

Rejected alternative: delete the config and let the grader infer entry points. This would discard
curated operator knowledge, make the judgement's premise vary run-to-run, and silently drop the
defense-in-depth roots — converting a false-negative the comment was written to prevent into the
default behavior.

**Story amendments required:**
- Story 1's happy path is qualified: entry points come from `config.wiring.entry_points`, rendered
  into the prompt; when the key is absent or empty, the wiring item reports "not judged" rather than
  passing or failing on an undefined premise.
- Story 4's "no residue" is scoped to exclude `WiringConfig` and the `wiring:` config block, which
  are explicitly retained.
- A new acceptance criterion: with `wiring.entry_points` unset, the wiring rubric item does not fail
  the build.

---

## Conflict: Preserved build_review verdicts become unreadable mid-flight

**Stories involved:** *Story ST-1496-5 — verdict compatibility for the new rubric key* vs the existing
gate-invalidation preservation policy
**Files:** `.docs/stories/...` Story 5 vs
`src/conductor/src/engine/gate-invalidation.ts:62,67,131-137`
**Type:** state-conflict
**Severity:** degrading

**Description:**
`gate-invalidation.ts` preserves gate verdicts across rebases under defined conditions. A feature
that passed `build_review` before this change carries a verdict with no `wiring` key. Story 5
correctly requires that verdict to read as "not judged" rather than as a pass — which means every
in-flight feature holding a preserved `build_review` verdict will re-run `build_review` once after
the upgrade.

**Accepted, not resolved.** This is the correct behavior: the rubric genuinely was not judged, and
treating the absence as a pass is the exact silent-pass failure Story 5 exists to prevent. The cost
is one extra `build_review` dispatch per in-flight feature, once. Recorded so the re-runs are
recognized as intended rather than diagnosed as a regression.

---

## Conflict: Deprecation notice frequency versus log signal

**Stories involved:** *Story ST-1496-2 — wiring_check runs as a deprecated no-op*
**Files:** `.docs/stories/...` Story 2 vs `src/conductor/src/daemon-cli.ts` renderer
**Type:** oscillating-requirement (mild)
**Severity:** degrading

**Description:**
Story 2 requires a deprecation event on every `wiring_check` execution. The step runs once per BUILD
attempt, and BUILD re-dispatches on every kickback from `test_suite` or `build_review`, so a feature
with several kickbacks emits the same notice several times. That is noise in the daemon log the
notice is meant to be visible in.

**Accepted.** Deduplicating would require per-feature notice state, which is durable state for a
purely informational signal — disproportionate, and the kind of bookkeeping the event spine exists to
avoid. The repetition is bounded by kickback count and each line is short. If it proves noisy in
practice, the renderer can collapse repeats, which is a presentation change requiring no schema work.

---

## Adjacent areas verified clean

| Area | Finding |
|---|---|
| `build_review` prerequisites (`steps.ts:184`) | Clean. `wiring_check` is retained as a no-op, so `prerequisites: ['wiring_check','test_suite']` resolves unchanged. This is precisely what `adr-2026-08-11-deprecated-no-op-step-retirement` was chosen to protect. |
| Protected-artifact seal (`plan-protected-targets.ts`, 4 call sites) | Clean. Story 6 fences `parsePlanTaskPaths` and the `**Files:**` grammar out of scope; the seal's branching on `hasFilesLineByTaskId` is untouched. |
| Autoheal path-fallback (`autoheal.ts:537-551`) | Clean. Consumes `parsePlanTaskPaths` only; unaffected by removing `WIRED_INTO_LINE`. |
| SHIP as-built reachability sweep (`architecture-review/SKILL.md:383-405`) | Clean. Behavior unchanged; gains only an ADR citation. No double-gating conflict — it judges shipped code at SHIP, the rubric item judges the diff at BUILD, and they cannot kick back against each other. |
| `.pipeline/events.jsonl` consumers | Clean. The new deprecation variant is additive to the `ConductorEvent` union; existing consumers read named fields and ignore unknown variants. |

## Summary

| # | Conflict | Type | Severity | Disposition |
|---|---|---|---|---|
| 1 | Judgement needs entry points the deletion removes | state-conflict | blocking | **Resolved** — retain `WiringConfig.entry_points`, render into the prompt; Stories 1 and 4 amended |
| 2 | Preserved verdicts re-run once after upgrade | state-conflict | degrading | Accepted — correct behavior, cost recorded |
| 3 | Deprecation notice repeats per kickback | oscillating | degrading | Accepted — presentation-fixable if it bites |
