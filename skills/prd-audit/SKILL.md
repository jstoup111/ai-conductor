---
name: prd-audit
disable-model-invocation: true
description: "Use at SHIP to judge the shipped implementation against the feature stories' acceptance criteria, with PRD and plan intent as context. Produces graded, criterion-level findings; does not implement or route work."
enforcement: gating
phase: ship
standalone: true
requires: [verify-claims]
model: opus
---

## Purpose

At SHIP, judge whether the implementation was built as the feature stories specify. The stories'
acceptance criteria are the authority. PRD functional requirements are intent context when a PRD
exists; the plan's stated outcome is also intent context. This is a finding-authority: report
grounded judgement and do not implement, amend DECIDE artifacts, append remediation tasks, or choose
the gate route. The engine owns those mechanical outcomes.

Each finding is keyed to one story criterion and carries exactly one grade:
`PASS | FIXABLE | PLAN_GAP | OVER_SCOPE`.

Per the `/verify-claims` protocol, cite concrete `file:line` evidence and give a confidence when
evidence is ambiguous. Do not turn uncertainty into a PASS.

Run at SHIP alongside the other SHIP validators. The configured step decides whether it is enabled;
this skill does not infer a skip from feature tier, track, or the absence of a PRD.

## Inputs and authority

1. Resolve the feature's committed stories through the active plan's `**Stories:**` reference.
   Read every happy and negative criterion. If criteria cannot be read, report a BLOCKED audit that
   names the stories file; never pass by default.
2. Read the active plan, including its stated outcome and task ownership. Where a committed
   coherence mapping exists, use it to understand criterion-to-intent traceability.
3. Read the matching non-`SUPERSEDED-` PRD when present. Its FRs explain intent; they do not replace
   story criteria as the audit key. A PRD requirement without story coverage is a `PLAN_GAP` finding
   against that requirement's missing criterion/traceability, not a silently omitted FR.
4. Read the implementation, changed tests, and relevant BUILD `Scope:` trailers. Trace each
   criterion to concrete behavior or its absence.

Use focused context per criterion. A broad codebase search is warranted only when targeted evidence
cannot establish whether that criterion was delivered.

## Judge each criterion

For every story criterion, record one row.

- **PASS** — the shipped behavior satisfies the criterion. Cite the code and/or behavioral proof.
- **FIXABLE** — the criterion is unmet and an existing active-plan task owns the repair.
  **FIXABLE names an owning plan task.** It also names the criterion it repairs; do not invent a
  task, and do not use this grade when the required work is outside the approved plan.
- **PLAN_GAP** — the criterion is unmet and no existing task owns its repair. Describe why the plan
  is insufficient. For a PRD requirement with no traced story criterion, make that missing coverage
  explicit as a PLAN_GAP rather than assessing the FR as though it were a criterion.
- **OVER_SCOPE** — shipped behavior goes beyond the planned implementation. Judge it against intent:
  PRD Goals/Non-Goals and In/Out Scope when available, otherwise the stories plus the plan outcome.
  State whether the widening is within intent, outside intent but not user-visible, or outside intent
  and user-visible. Include any `Scope:` trailer rationale and operator-reseal rationale in the
  evidence. A reseal rationale that does not justify the protected-artifact change is an OVER_SCOPE
  finding; a rationale that does justify it is evidence for no finding.

Do not conflate grades: an unmet criterion with an existing owner is FIXABLE even if another
criterion is a PLAN_GAP. One row carries one grade.

## Report

Write `.pipeline/prd-audit.md` as current run evidence, overwriting the prior run. Declare whether a
PRD was present, name all intent sources, and use the criterion-grade Verdict Table as the routing
contract. Per-FR evidence may appear below the table, but never replaces the criterion rows.

```markdown
# PRD Audit: <Feature Name>
**Date:** YYYY-MM-DD
**PRD:** present | none
**Intent sources:** stories: .docs/stories/<feature>.md; PRD: .docs/specs/<feature>.md | none; plan outcome: <outcome>
**Overall:** PASS | BLOCKED

## Verdict Table

| Criterion | Grade | Plan task | PRD: | Evidence |
| --- | --- | --- | --- | --- |
| S6.1 | PASS | — | FR-7 | src/engine/example.ts:42 — implements the criterion |
| S6.2 | FIXABLE | 4 | FR-7 | src/engine/example.ts:58 — missing guard |
| S6.3 | PLAN_GAP | — | FR-7 | No active task owns the missing behavior |
| S9.2 | OVER_SCOPE | — | FR-9 | src/engine/example.ts:77 — outside intent, user-visible |

## Criterion detail
### S6.2 — <criterion summary>
**Grade:** FIXABLE
**Confidence:** 95% (verified)
**Evidence:** `src/engine/example.ts:58` — <what it proves or lacks>
**Rationale:** <why this grade follows from the criterion, its intent context, and task ownership>
```

The Verdict Table needs one row for every readable story criterion. Use `—` for an absent Plan task,
but only FIXABLE rows may name a task and that task must exist in the active plan. `PRD:` records the
intent FR(s) when known and `none` when there is no PRD. If report evidence is malformed or
incomplete, surface it as BLOCKED rather than fabricating a grade.

For OVER_SCOPE rows, add the intent judgement and reseal rationale to the detail: which source was
consulted, whether the behavior is user-visible, and why any Scope/reseal rationale does or does not
justify the widening. Do not self-accept, halt, or otherwise route the finding; the engine applies
the policy to this evidence.

## Verification

- [ ] Active-plan stories loaded; each readable criterion has one Verdict Table row
- [ ] Stories treated as authority; PRD FRs and plan outcome recorded only as intent context
- [ ] `**PRD:** present | none` and the intent-sources line state what was available
- [ ] Each row has exactly one of PASS, FIXABLE, PLAN_GAP, or OVER_SCOPE
- [ ] Every FIXABLE row names its existing owning plan task and its criterion
- [ ] Unreadable criteria and PRD-to-story coverage gaps are surfaced, never silently passed
- [ ] Each finding cites `file:line` evidence and has calibrated confidence where ambiguous
- [ ] OVER_SCOPE detail judges intent, user visibility, Scope trailers, and reseal rationale
- [ ] Report written to `.pipeline/prd-audit.md`; no implementation, plan mutation, or routing performed
