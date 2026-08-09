# Coherence Mapping: build-post-task-tail-telemetry

**Date:** 2026-08-08
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD, therefore no `FR-N` ids). The
stories file substitutes three intake outcome ids (O1/O4/O6) on its `**Requirement:**` lines.
**Source-Ref:** jstoup111/ai-conductor#1176
**Outcomes source:** `.pipeline/intake-outcomes.md` (staged at worktree creation from the claim
record), bullets numbered 1-6 in file order.

Every `covered` verdict below was confirmed by reading the counterpart artifact file and
checking the cited id exists there — not inferred from a plausible phrase match. Story ids were
read from the six `## Story <id>:` headings; task ids from the seventeen `### Task <id>:`
headings and their seventeen single-id `**Story:**` lines.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-3, story-5, story-6 | covered | "Post-task BUILD latency is measured separately from task execution latency." Cited as O1 on the `**Requirement:**` lines of Stories 1, 2, 3, 5, 6. |
| outcome | outcome-2 |  | gap | `outcome-2` — "reaches BUILD completion without unconditional idle time." Intentionally unmapped: **already true**. Measured `provider ≈ active ≈ wall` in every re-entry (6.8/6.6, 14.9/14.8, 5.1/5.0 min), so the build step is ~97% LLM time and there is no unconditional idle to remove. Waived. |
| outcome | outcome-3 |  | gap | `outcome-3` — "equivalent verification or judgment evidence is produced once and reused by downstream gates." Intentionally deferred to a v1 follow-up blocked on this telemetry. Waived. |
| outcome | outcome-4 | story-2, story-4 | covered | "Required simplify, architecture, documentation, memory, and quality contracts remain satisfied with explicit durable evidence." Cited as O4 on Stories 2 and 4. Story 2 produces the durable evidence; Story 4 makes it non-optional. |
| outcome | outcome-5 |  | gap | `outcome-5` — "p95 post-task tail reduced by at least 50% from a baseline." Intentionally out of scope: the metric conflates kickback remediation with closeout ceremony (~197 of 202 measured tail-minutes are real rework), so it could be satisfied by shipping less work. Re-targeting is an ADR follow-up action. Waived. |
| outcome | outcome-6 | story-4 | covered | "Negative path: missing, stale, or failed evidence still blocks progression and triggers only the necessary rework." Cited as O6 on Story 4, whose negative paths assert the batch boundary BLOCKS on an unrecorded obligation. |

| story | story-1 | task-1, task-2, task-3, task-4 | covered | Tick provenance. Task 4 carries the negative path (failed HEAD probe still emits `headMoved: false`). |
| story | story-2 | task-5, task-6, task-7, task-8 | covered | Closeout events from the pipeline's own process. Task 6 asserts `.pipeline/events.jsonl` is byte-identical (one-writer rule); Task 8 carries the negative path. |
| story | story-3 | task-9, task-10, task-11 | covered | Tail and re-emit. Task 11 carries the negative paths (stop-on-reject, absent ledger). |
| story | story-4 | task-12 | covered | Single task by design — the gate extension is one edit to an existing gate, and its three negative assertions live inside that task's RED step. |
| story | story-5 | task-13, task-14, task-15 | covered | Rollup. Task 15 carries every degradation path (`partial`/`unavailable`/`unrecorded`). |
| story | story-6 | task-16, task-17 | covered | Reporting subcommand and the committed baseline. |

| task | task-1 | story-1 | covered | `infrastructure` — declares the two additive fields the emitting tasks set. |
| task | task-2 | story-1 | covered | |
| task | task-3 | story-1 | covered | |
| task | task-4 | story-1 | covered | negative-path |
| task | task-5 | story-2 | covered | `infrastructure` — declares the closeout union member. |
| task | task-6 | story-2 | covered | |
| task | task-7 | story-2 | covered | |
| task | task-8 | story-2 | covered | negative-path |
| task | task-9 | story-3 | covered | |
| task | task-10 | story-3 | covered | |
| task | task-11 | story-3 | covered | negative-path |
| task | task-12 | story-4 | covered | negative-path |
| task | task-13 | story-5 | covered | `infrastructure` — ledger merge and window extraction. |
| task | task-14 | story-5 | covered | |
| task | task-15 | story-5 | covered | negative-path |
| task | task-16 | story-6 | covered | |
| task | task-17 | story-6 | covered | |

## Assumptions surfaced

None unresolved. Two judgment calls are recorded rather than silently resolved:

1. **The outcome layer uses the staged `.pipeline/intake-outcomes.md`**, whose `Source-Ref`
   matches the claimed intake. Bullet numbering is file order. Confidence 95%, *verified* — the
   file was read directly and its six bullets map 1:1 to the intake body.
2. **`story-4` maps to a single task.** A one-task story can look like thin coverage. Confirmed
   genuine rather than a shortfall: Story 4's three negative assertions (unrecorded obligation
   blocks; empty `review.json` still blocks independently; another obligation's event does not
   satisfy the check) are all named inside Task 12's RED step, and the change is a single
   additive edit to one existing gate. Confidence 90%, *verified* against both files.

## Documentation coverage

No documentation tasks appear in the plan, by design — this repository routes reader-facing
documentation through its `maintain-documentation` custom step, and the `plan` skill prohibits
documentation tasks. This is not a coverage gap in any row class above. Affected pages for that
step: `docs/reference/cli.md` (two new subcommands) and `docs/reference/artifacts.md` (the new
sibling ledger).

## Summary

- **outcome:** 3 covered, 3 gap — all three gaps intentional and waived in
  `.docs/coherence-waivers/build-post-task-tail-telemetry.md`
- **fr:** omitted (technical track, no PRD)
- **story:** 6 covered, 0 gap
- **task:** 17 covered, 0 gap
