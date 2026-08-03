# Architecture review: v1 interface lock for parallel task-stream dispatch (#552)

**Date:** 2026-08-02
**Tier:** L — full review
**Verdict:** APPROVED with one escalation and one operator-confirmation item
**ADR:** `adr-2026-08-02-v1-parallel-dispatch-surface-lock` (APPROVED)

## What was reviewed

The surface enumeration and the FROZEN / WIDENED / RESERVED pin assigned to each of the 14
consumer-visible surfaces #474 must touch, against the tree at `a57e7221b`. Four independent
discovery passes mapped attribution, the step-group seam, hook wiring plus the release gate,
and the plan/config contracts; every pin in the ADR carries a file:line anchor.

## Feasibility

**The lock is achievable, and cheaper than expected, for one structural reason:** the two
things #474 most needs already exist in shipped, consumer-visible form.

1. Per-task file sets are already parsed (`plan-task-parse.ts:70-239`) and already consumed
   by four callers — the overlap veto's input needs no new contract, only a stated rule for
   the empty-set case (S11).
2. A per-instance identity dimension already exists in the state-key space: the config
   `parallel:` DSL writes `<step>__<branch>` synthetic keys (`types/config.ts:43`,
   `conductor.ts:7314`). #474's streams reuse that grammar rather than inventing one, which
   removes the largest candidate breaking change from the table entirely.

The genuine gap is narrower than #474's proposal assumes: dependency **edges** are not parsed
anywhere (only the presence of the literal string is checked, `artifacts.ts:3016-3022`), so
the half of stream detection that reads the plan's dependency graph has no contract at all
today. That is the surface most exposed to drift and the one the lock most needs.

## Alignment

- **Consistent with the shipped concurrency seam.** #469/#922 landed `StepGroup` fan-out with
  a single-writer join (`conductor.ts:3179-4086`). This lock does not extend or generalize
  that seam — correctly, since #474's cardinality (N instances of one step) is a different
  shape from a group's (one instance each of N distinct steps). The ADR records the
  difference rather than papering over it.
- **Consistent with the repository Design Principle.** Choosing Option C (enforcement in v1)
  over Option A (prose only) is the direct application of "never rely on prompt discipline
  for something machinery can enforce." The review finds the supporting evidence unusually
  strong: `adr-2026-07-10-session-hook-task-stamping`'s central mechanism was deleted in an
  unrelated refactor and no test, gate, or reviewer caught it — the ADR still reads as
  current. A prose-only pin has already failed on precisely this surface.
- **Consistent with #228 Wave B.** The deliverable is a merged spec that closes a one-way
  door before #226, not an implementation of #474, which stays open and stays blocked by #531.

## Risks

| Risk | Severity | Mitigation in the design |
| --- | --- | --- |
| A pin is enforced only by prose and decays before #474 builds | High | Every pin lands with a test in v1; three (S3, S10, S13) additionally require code or the pin is factually false at the tag |
| The v1 diff destabilizes the cutover window | Medium | Nine narrowly-scoped tasks, each independently valuable on its own merits; no change to dispatch behavior, no change under `hooks/`, no change to the group seam |
| `ParallelBranch.name` tightening rejects a live consumer config | Low | The key ships in no template, is absent from this repo's own config, and any name that would newly fail already produces an ambiguous state key. Escalated explicitly and requires a CHANGELOG entry |
| #531 later needs `.pipeline/current-task` to change shape | Medium | S1 freezes the format and S2 reserves `.pipeline/lanes/` precisely so #531 has somewhere to put per-lane state without touching the two operator-installed hooks that read the scalar |
| `tool_use_id` disappears from a future host payload | Low | S8 is additive telemetry; no gate depends on it and the documented degradation is "correlation absent," never a failure |
| The release gate's path classifier gives false comfort | Medium | Explicitly recorded as a non-mitigation: the classifier is path-based (`release-gate.ts:153-169`), so it cannot verify semantic compatibility. Tests, not the gate, defend these pins |

## Findings requiring action

1. **ESCALATION (operator, before #226 merges).** S3's charset validation is a tightening that
   ships breaking in v1, per #552's negative path. Recorded in the ADR's Escalation section;
   the plan carries the CHANGELOG entry as an explicit task.
2. **OPERATOR CONFIRMATION (at merge).** The ADR reads #552 as requiring v1 enforcement code
   rather than prose alone. This is the Option A/C fork and it changes the plan from zero
   tasks to nine. Grounded in #552's own no-migration-block requirement, which S3, S10 and
   S13 cannot satisfy without v1 code — but it is the operator's call, and merging the spec
   PR is where that call gets made.
3. **NOT IN SCOPE, referred onward.** `skills/pipeline/SKILL.md:52-66, 83, 103` documents
   `current-task` behavior that no longer exists. Only the fragment stating S1's contract is
   corrected here; the rest belongs to #531. Similarly, `.pipeline/dispatch-count` is never
   truncated or rotated (`attribution-telemetry.ts` has no writer beyond the hook), so its
   "per build cycle" framing holds only for the first cycle in a worktree — a pre-existing
   defect, out of scope, worth a separate intake.

## ADR status

`adr-2026-08-02-v1-parallel-dispatch-surface-lock` — **APPROVED**. No DRAFT ADRs remain for
this feature.
