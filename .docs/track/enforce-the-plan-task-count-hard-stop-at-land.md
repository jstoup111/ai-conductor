# Track: Enforce the plan task-count hard stop at land

Track: technical

Scope boundary: Small fix for #1645, approved by the operator on 2026-09-06 (delegated). Make the
documented top scope band bite mechanically at the spec land gate, give an over-threshold plan one
explicit in-artifact way to proceed, and give the band boundaries a single source the gate and the
authoring skill both read. Recalibrating the threshold values themselves, the warning band's
authoring-time prompt, remediation tasks appended to an already-landed plan, a new CLI subcommand,
and any new configuration key are outside this slice.

This is an engine gate and skill-text correction with no product requirements; acceptance criteria
live in technical stories rather than a PRD.

The operator-delegated decision on 2026-09-06 chose an explicit plan-header declaration over the
skill's current `.memory/decisions/` instruction as the durable record. The plan is already a
committed, reviewed artifact travelling with the spec PR, so the rationale is readable afterward by
someone who was not present; an uncommitted memory file depends on the authoring agent remembering
to write it, which is the failure the issue reports. The band boundaries stay at their current
values because the issue's own measurement is evidence for them, not against them.

Scope check: A — consumer-facing (the land gate and the `plan` skill both install into and run in
every repository that uses the harness; no self-host, daemon, sandbox, repository-CI, or
repository-only validation surface is touched); B — n/a (no new skill); C — provider-agnostic (a
deterministic engine check plus provider-neutral skill prose; no host-specific path, capability, or
invocation mechanic). No catalog registration is required. Event spine: no new event, metric, span,
or report — the gate refuses through the existing `landSpec` error path that every other land gate
already uses.

Verified foundation: `src/conductor/src/engine/engineer/land-spec.ts` runs its plan gates in one
block after reading the plan artifact — `scanPlanProtectedTargets` at line 254 and
`validatePlanDoneWhen` (imported at line 66) at line 265 — each a pure text predicate whose
violations are rendered into a thrown `landSpec:` error. `src/conductor/src/engine/plan-done-when.ts`
is the shape precedent: a single exported validator over plan text with no filesystem boundary.
`src/conductor/src/engine/plan-task-parse.ts` already owns the shared task grammar —
`TASK_HEADER_PATTERN` (line 77) and `parsePlanTaskBodies` (line 190), which skips fenced regions and
expands comma-listed ids — so the addressable task count is derivable from machinery that already
exists rather than a new heading regex. `skills/plan/SKILL.md:375-385` carries the three-band table
and the `.memory/decisions/` sentence, and nothing in `src/conductor` reads either.
