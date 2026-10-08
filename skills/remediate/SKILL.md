---
name: remediate
disable-model-invocation: true
description: "Use when build_review fails or, at SHIP, when prd-audit, the as-built architecture review, or finish verification blocks. Guides remediation toward the owning step and HALTs only for gaps that need a human."
enforcement: gating
phase: ship
standalone: true
requires: [verify-claims]
---

## Purpose

Turns a **blocking gate into action**. When `build_review` fails, or when `prd-audit`,
`architecture-review --as-built`, or the `finish` verification reports SHIP gaps the daemon would
otherwise HALT on, this skill reasons over each blocking gap and decides *how the daemon should
proceed* — autonomously where it can, human-in-the-loop only where it must.

**Correctness gate:** a gap's disposition and its routing target rest on a claim about the gap's
nature. Per the `/verify-claims` protocol, ground that classification in the audit evidence with a
confidence %, and do not auto-route on an unverified assumption about what the gap is — when the
nature is genuinely uncertain (not just the fix), that low confidence is itself a signal to HALT
for a human rather than to guess a route.

The daemon should be autonomous. So the default is to **remediate**: translate each gap into
concrete, file-scoped work and route it back to the right SDLC step. A **HALT** is reserved for the
three cases a machine genuinely cannot close:

1. **architectural-clarity** — an architectural gap that needs a human *decision* (ambiguous trade-off,
   missing ADR, conflicting constraints), not just a code change.
2. **product-scope** — functionality the **initial design never accounted for** (a real product gap),
   which needs a human DECIDE amendment.
3. **unanswerable** — a stall-question that cannot be answered from committed artifacts alone and
   needs more evidence.

If a gap can be turned into concrete work, it is **not** a HALT. This skill guides planning only: it
does **not** edit code, write tests, or amend the PRD; the owning step does that.

**Run when `build_review` fails, or at SHIP when a prior audit BLOCKED — dispatched by the
conductor on the blocking path.**

## Engine-selected PRD widening reconciliation mode

Use this branch **only when the engine-stamped context declares**
`mode: "prd-widening-reconciliation"`. It is one bounded equivalence judgment through the
existing `remediate` dispatch, not a lifecycle step, a new skill, or a BUILD remediation plan.

Judge only the engine-supplied projection. For each current source, decide whether the supplied
evidence supports the same retained case, a different case, or uncertainty. A same-case judgment
must name only an existing supplied case and explain the substantive behavioral equivalence; when
the supplied evidence cannot establish that relation, choose uncertainty rather than guessing from
summary wording, ordinal, commit, or path similarity. Do not inspect the repository, seek extra
evidence, or invent a new case, source, decision, or operator authority.

The engine owns the projection, native schema, terminal-result validation, durable IDs, and every
effect. Do not create BUILD work, amend a plan, write a remediation artifact, or recover a result
from markdown/prose. For every other mode, including `build_review` `case-v1`/`case-v2` and legacy gap
planning, skip this branch and follow the existing instructions unchanged.

## Engine-selected refusal-rework mode

Use this branch **only when the engine-stamped dispatch context carries refusal evidence** for a
SHIP `prd_audit` over-scope report whose blocking outside-visible findings were all refused by the
operator. It is one removal/rework judgement by the existing `remediate` planner — not a new skill,
a second dispatch, or a new store. For every other context, follow the applicable engine-selected
mode or the gap-plan judgment guidance below.

### Removal-only rule

A refusal gap is removal-only. Every emitted task must remove the refused behavior or rework it to
fit within the recorded decision; no task may introduce new capability, and no new behavior may be
introduced. If the planner cannot produce such tasks — or returns a human/deferral disposition or
an empty, unbound task list — the engine writes the existing refused HALT, never a generic
needs-human halt that drops the decision.

## Engine-selected build_review case-v1 mode

Use this branch **only when this engine context is the engine-stamped `build_review` `case-v1` case context declaring `domain: "build_review"` and `mode: "case-v1"` or `"case-v2"`**. It is one judgement by
the existing `remediate` skill, not a new skill or a second dispatch. Do not create a skill or dispatch another agent. For every other context, including all SHIP and stall remediation, skip this
section and follow the legacy gap-plan instructions below unchanged.

### Supplied input — complete or stop

Judge only the frozen, byte-bounded projection supplied in the engine context. Its exact input fields
are:

- `domain`: `build_review`.
- `currentFindings`: every current operator-unresolved content finding, each with its rubric id,
  stable finding id, anchor, summary, and evidence locations.
- `priorCases`: all feature-local prior cases, each with outcome, source links, effect status, and
  resolution evidence.
- `planContract`: the active approved-plan contract that determines whether work is admitted.
- `taskStatus`: the engine-supplied task-status evidence.
- `effectPointers`: the engine-supplied prior effect and BUILD-attempt pointers.
- `suppressionHistory`: engine-owned sub-floor finding history. It is context only, never a
  current source and therefore receives no `sourceOutcomes` row.

All feature-local prior cases must be present or stop: never infer, truncate, or silently ignore
history. Every supplied current finding must receive exactly one source outcome. Use the supplied
stable identifiers and evidence to make semantic judgements; do not match summaries as identity.

Do not re-audit the source tree. Do not read sibling rubric prompts, inspect a different review
artifact, or seek additional repository evidence. The engine already selected the scope, excluded exact
operator-resolved findings, assembled all history, and bounded the input. If the supplied projection
cannot support a justified judgement, return the required schema with the most supportable
case-level disposition; do not substitute a legacy gap plan or invent missing evidence.

### Required additive artifact

Overwrite `.pipeline/remediation.json` with one JSON object using exactly these top-level keys:
`mode`, `domain`, `sourceOutcomes`, `cases`. Set `mode` to `"case-v1"` and `domain` to
`"build_review"`; do not add legacy `dispositions` or any other keys.

`sourceOutcomes` contains one exact row with `sourceId`, `outcome`, `caseRef` for every and only the
supplied `currentFindings` identifier. `outcome` is closed: `acted` | `deferred` | `rejected` | `merged` | `refuted`.
Each `caseRef` is a provider-local reference to one canonical row in `cases`; it is not a durable id.
Several source rows may reference one canonical case only when the judgement is that they are the same
repair case.

Each `cases` row has exactly `caseRef`, optional `existingCaseId`, `disposition`, `priority`,
`rationale`, `confidence`, `effect`; a `refute` row additionally carries `refutation`:

- `caseRef` is the provider-local reference used by source rows. `existingCaseId`, when supplied by
  the engine in `priorCases`, may bind that existing case only.
- `disposition` is closed: `act` | `defer` | `reject` | `refute`.
- `priority` is closed: `critical` | `high` | `medium` | `low`.
- `rationale` is bounded, evidence-grounded prose explaining the judgement, and `confidence` is
  closed: `high` | `medium` | `low`.
- An `act` effect is exactly `{ "kind": "action", "route": "build", "tasks": [{ "title": "..." }] }`.
  It contains one or more concrete, ordered, file-scoped task titles.
- A `defer` effect is exactly `{ "kind": "deferral", "title": "...", "body": "...",
  "exclusionRationale": "..." }`. Its `exclusionRationale` explains why no current plan task admits
  the work.
- A `reject` effect is exactly `{ "kind": "none" }` and its rationale explains why the raw finding
  is non-actionable under the supplied rubric and plan contract.
- A `refute` row MUST bind an `existingCaseId` for an already attempted `act` case, use confidence
  `high`, and use either `{ "kind": "none" }` or a complete deferral effect. Its `refutation` is
  exactly `{ "claim": "...", "assertions": [...] }`; every assertion has `assertion`, a `refuted` or
  `upheld` verdict, and evidence entries containing only `path` and `excerpt`. Evidence proves current
  tree content: use no line numbers, hunks, commits, or SHAs. A case may be refuted once only; a later
  attempt to refute the same case is rejected for human review.

### Authority boundaries

The provider must not mint durable case ids or effect ids. The engine validates the complete graph.
The engine stamps durable ids, reconciles history, reserves and applies effects, publishes any work
order, charges the kickback, and derives the effective route.

Never omit, duplicate, or replace a supplied source outcome. A `merged` source is a trace outcome,
not a case disposition; it still names its canonical `caseRef`. Never assert or create operator
acceptance, and never treat an autonomous case outcome as accepted risk. Do not apply an effect,
file an intake issue, navigate BUILD, charge a budget, or mutate durable state. Do not append to the
approved plan. In this mode the only write is the schema-constrained `.pipeline/remediation.json`
artifact.

### case-v2 consistency, admission, and decision stops

When the engine stamps `mode: "case-v2"`, write exactly the v1 graph fields plus a top-level
`consistency` object; its exact top-level keys are `mode`, `domain`, `sourceOutcomes`, `cases`, and
`consistency`. The `consistency` object is exactly `{ "verdict": "consistent" | "blocked",
"sourceIds": ["..."], "caseRefs": ["..."], "rationale": "..." }`. It names the implicated
current sources and canonical case rows, and gives bounded, evidence-grounded rationale. Do not
drop merge rows: every merged source still cites its canonical case, so the graph retains its
original source and merge provenance.

For a v2 `act`, every effect task is exactly `{ "title": "...", "admittedTaskIds": ["..."],
"admissionRationale": "..." }`. `admittedTaskIds` names the existing active-plan tasks that admit
that repair, and `admissionRationale` explains the approved-scope fit. Never invent a task id or
append a plan task.

v2 adds `escalate` as both a source outcome and a case disposition. An escalation case has exactly
the ordinary case fields plus `"escalation": { "owner": "product" | "plan" | "architecture" }`
and its effect is exactly `{ "kind": "none" }`. Its source rows, case rationale, and consistency
record are the operator-facing evidence. It creates no action, operator acceptance, tracker effect,
plan mutation, BUILD navigation, or budget charge. Use `blocked` consistency for an unresolved
contradiction; a `consistent` verdict still does not authorize work outside the admitted task ids.

The inherited `refute`/`refuted` record is unchanged in v2: keep its existing-case binding,
high-confidence assertion evidence, and terminal semantics. Do not create a parallel refutation
shape.

## Mode-neutral remediation context

When the dispatch context includes `plan contract:` or `prior attempts:` pointers, read every
referenced file before judging repairs. Treat the referenced plan task's **Steps** as the governing
contract for the repair; prior-attempt artifacts supply earlier same-anchor context, not a replacement
contract. When no pointers appear, inspect `.docs/plans/` and `.pipeline/build-review/` directly
before judging the repair.

When used interactively, produce a human-readable remediation plan for the operator. It is advice,
not a managed persisted result, and does not replace the engine's selected input, validation, or
routing.

## Gap-plan judgment guidance

**Environmental stalls — check first, halt cheaply.** Before any other analysis of a stall question,
decide whether its cause is the environment rather than the work: a service, container, database,
network dependency, credential, or tool the build or test gate needs is down, crashing, or
unreachable. No plan, story, ADR, or code change repairs the machine, so committed artifacts cannot
answer the question. Halt it as `unanswerable` immediately: preserve the question verbatim, state
that the cause is environmental, and name the failing dependency as the question reports it. Do not
dispatch `remediation-planner`, delegate, diagnose the dependency, read source, or propose
configuration changes as a workaround.

**HALT is reserved for `architectural-clarity`, `product-scope`, and `unanswerable` stall questions
only.** Use `architectural-clarity` when an architectural gap needs a human decision before any code
can be right; use `product-scope` when the initial design never covered the functionality; use
`unanswerable` only when a stall question cannot be answered from committed artifacts alone. Every
other gap should be turned into concrete work.

- **Sealed-artifact amendments return to DECIDE.** When a gap requires amending another feature's
  artifact under `.docs/architecture/`, `.docs/decisions/`, `.docs/plans/`, `.docs/specs/`, or
  `.docs/stories/`, do not route it to BUILD or acceptance-spec work. Return it to the owning DECIDE
  step through the existing operator gate and kickback path; make no request, ledger, record, or new
  artifact to bypass that ownership.
- **Prefer autonomous remediation.** When approved architecture remains authoritative, clear
  implementation/test/documentation drift belongs in BUILD, including a conforming as-built finding
  and an answerable build-stall question. Its audit origin or finding id alone does not determine the
  route. Use `architecture_review` only when a change to, or clarification of, approved architecture
  is required; do not use it where no architectural decision is needed.
- **Reject contradictory dispositions.** Selecting `architecture_review` when no architectural
  decision or product decision is needed is invalid; route clear conforming implementation, test, or
  documentation work to BUILD instead. Selecting `build` when an unresolved or ambiguous
  architectural decision remains is invalid; use `architecture_review` when approved architecture
  must change or be clarified, or HALT for architectural clarity when a human decision is required.
- **Coverage and planning judgment.** An implementation gap is ordinarily BUILD work; use
  `acceptance_specs` when the real miss is acceptance coverage. A baseline-passing test that needs
  strengthening within an existing task's RED/GREEN work is BUILD work, not a planning omission. A
  `plan` route is for an in-scope plan omission, not an architecture or design decision: before
  selecting `plan`, examine the approved tasks and use it only when none admits the repair. A `plan`
  route is terminal in a daemon run and never re-plans.
- **Recorded RED exception.** An acceptance-spec repair may waive separate RED proof only when the
  acceptance spec and its implementation must be repaired atomically. Record a non-empty reason and
  attributable approval; report the result as waived, never as proven RED. Otherwise use the ordinary
  failing-spec RED path.
- **Preserve completed behavior and coverage.** A repair that removes, replaces, rewrites, or
  relaxes existing code, tests, or assertions must identify the completed plan task or story
  criterion whose behavior and coverage survive it. If a removal makes coverage genuinely redundant,
  include the replacement in the same repair.
- **Close the defect class within plan admission.** Check sibling sites and what a removal would
  orphan. Include a sibling only when an existing plan task admits it; otherwise record it as found
  and excluded with the reason. Do not widen the work beyond approved scope merely because the same
  shape occurs elsewhere.
- **Low confidence halts.** Do not route on an unverified assumption about a gap's nature. When the
  nature is genuinely uncertain, rather than merely the fix, HALT for a human instead of guessing a
  route, as required by `verify-claims`.
