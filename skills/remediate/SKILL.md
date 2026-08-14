---
name: remediate
description: "Use at SHIP when prd-audit, the as-built architecture review, or the finish verification blocks. Emits a per-gap disposition and concrete tasks routed to the owning step, and HALTs only for gaps that need a human."
enforcement: gating
phase: ship
standalone: true
requires: [verify-claims]
---

## Purpose

Turns a **blocking SHIP gate into action**. When `prd-audit`, `architecture-review --as-built`, or
the `finish` verification reports gaps the daemon would otherwise HALT on, this skill reasons over
each blocking gap and decides *how the daemon should proceed* — autonomously where it can,
human-in-the-loop only where it must.

**Correctness gate:** a gap's disposition and its routing target rest on a claim about the gap's
nature. Per the `/verify-claims` protocol, ground that classification in the audit evidence with a
confidence %, and do not auto-route on an unverified assumption about what the gap is — when the
nature is genuinely uncertain (not just the fix), that low confidence is itself a signal to HALT
for a human rather than to guess a route.

The daemon should be autonomous. So the default is to **remediate**: translate each gap into
concrete, file-scoped work and route it back to the right SDLC step. A **HALT** is reserved for the
two cases a machine genuinely cannot close:

1. **architectural-clarity** — an architectural gap that needs a human *decision* (ambiguous trade-off,
   missing ADR, conflicting constraints), not just a code change.
2. **product-scope** — functionality the **initial design never accounted for** (a real product gap),
   which needs a human DECIDE amendment.

If a gap can be turned into concrete work, it is **not** a HALT. This skill plans only — it assigns
dispositions and writes tasks. It does **not** edit code, write tests, or amend the PRD; the step it
kicks back to does that.

**Run at SHIP, only when a prior audit BLOCKED — dispatched by the conductor on the blocking path.**

## Practices

### 1. Load Input

Read the blocking gaps or stall-question and their per-gap evidence from whichever trigger
dispatched this skill (the conductor's dispatch context names it):

**Gap-based inputs (prd-audit, architecture-review_as-built, finish failure, build_review trigger):**
- `.pipeline/prd-audit.md` — the per-FR verdict table + Per-FR Detail (verdict, gap-class,
  `file:line` evidence). Blocking rows are the `FR-N` rows that are `MISSING`/`PARTIAL`/`DIVERGED`
  and **not** `ACCEPTED`.
- `.pipeline/architecture-review-as-built.md` — present when the as-built compliance gate blocked
  (verdict `BLOCKED`, with the violated APPROVED ADR(s) and evidence).
- `.pipeline/test-failures.md` — present when the `finish` verification found real (non-flake)
  test failures: per failing file, the tests, one-line reasons, and finish's read on the cause.
  If finish left no artifact (older skill, or it crashed), fall back to running the failing part
  of the suite yourself to gather the evidence.
- `.pipeline/build-review.json` — present when the `build_review` trigger dispatches remediation
  after a FAIL verdict. Read its rubric findings and reasons as the per-gap evidence.

**Stall-question input (daemon mode only, build_stall trigger):**
- `.pipeline/build-stall-question.md` — present when the build step stalled with
  `halt-user-input-required` marker (ADR-2026-07-10). Contains a question posed by the build
  agent, not a gap list. The agent was unable to decide autonomously and needs human input or
  artifact-based inference to proceed. Examples: "Should this validation live in the controller
  or the model?", "The acceptance spec faked X, but the real setup needs Y — which is correct?".

Consider **only the blocking gaps or the stall question**. Each gap already carries
`file:line` evidence — use it; do not re-audit from scratch. A stall question should be
answered by reasoning over committed artifacts (plan, stories, ADRs, task-status) without
re-reading source files unless essential.

### 2. Dispatch `remediation-planner`

Dispatch the **`remediation-planner`** agent with the blocking gaps + their evidence. The agent
returns, per gap, a **disposition** and (for autonomous dispositions) concrete file-scoped **tasks**.
Keep context tight: feed the agent the blocking gaps and their evidence, not the whole codebase.

### 3. Disposition Decision

Each blocking gap or stall-question gets exactly one disposition. **HALT is reserved for
`architectural-clarity`, `product-scope`, and `unanswerable` stall-questions only** — every other
gap must be turned into concrete work:

| Disposition | When | Daemon effect |
|---|---|---|
| `build` | impl / test / wiring bug with clear evidence (the fix is obvious from the gap); **implementation/test/documentation drift that preserves the approved architecture**; OR **stall-question is answerable from committed artifacts** | inject the emitted tasks → kick to **build**; for stall-questions, answer lives in `rationale`, `tasks: []` |
| `acceptance_specs` | the gap exists because acceptance coverage is missing or too weak to pin the behavior | kick to **acceptance_specs** (regenerate failing specs), then build |
| `architecture_review` | changing or clarifying **approved architecture** is required before the gap can be closed | kick to **architecture_review** |
| `plan` | functionality that **is in scope** but the plan simply omitted or missed (a planning omission, not an architecture or design decision) | kick to **plan** (re-plan), then build |
| `halt` + `category: architectural-clarity` | an architectural gap that needs a human *decision* before any code can be right; OR **stall-question requires architectural judgement beyond the committed spec** | **HALT** for human |
| `halt` + `category: product-scope` | functionality the **initial design never covered**; OR **stall-question hinges on product-level decision not in the PRD** | **HALT** for human DECIDE |
| `halt` + `category: unanswerable` | **stall-question only:** the question is ambiguous or cannot be answered from committed artifacts alone; need more evidence | **HALT** — flag the question as unanswerable and preserve it verbatim |

Judgment rules:
- **Sealed-artifact amendments return to DECIDE.** When a gap requires amending another feature's
  artifact under `.docs/architecture/`, `.docs/plans/`, `.docs/specs/`, or `.docs/stories/`, do
  not assign `build` or `acceptance_specs`. Route it to the owning DECIDE step through the existing
  operator gate and DECIDE kickback path; make no request, ledger, record, or new artifact to bypass
  that ownership.
- **Prefer autonomous.** If the daemon can produce concrete tasks that close the gap, it must — even
  for `DIVERGED`/ADR-drift gaps, as long as the *correct* fix is determinable from the evidence.
  The audit origin or finding id alone does not determine the route: an as-built architecture-review
  finding whose approved architecture remains applicable and authoritative routes to `build` when
  it is conforming implementation/test/documentation drift.
- **HALT is the exception, not the default.** Only the two human categories above HALT. "I'm not sure
  how to fix it" is not a HALT category — if the gap is an impl bug you can describe as a task, it is
  `build`.
- A gap that is an `impl-gap` in the audit is almost always `build` (or `acceptance_specs` when the
  real miss is coverage).
- **Baseline-passing test gaps are `build`.** Positive example: a changed test that passes against
  the baseline and needs strengthening within an existing task's RED/GREEN steps is `build`, not a
  planning miss. Negative example: do not select `plan` merely because the existing test passed
  against the baseline.
- **RED-waiver obligation:** An `acceptance_specs` disposition may waive separate RED proof only
  for a remediation that must atomically repair both the acceptance spec and its implementation.
  The disposition must require a recorded declaration with a non-empty reason and attributable
  approval; the resulting completion is reported as waived, never as proven RED. Without that
  declaration, route the gap through the ordinary failing-spec RED path.
- **Finish test failures are almost always `build`.** Decide what the failure means first: a test
  that lags an **intentional contract change** made on this branch gets tasks that update the
  TEST to the new contract — never a task that weakens the production code to appease the old
  test. A test that reveals a real implementation bug gets impl-fix tasks. Reserve `halt` for a
  failure that evidences a genuine design ambiguity, not mere uncertainty about the fix.
- An `intended-drift` is `halt: product-scope` **only** if it reflects unplanned product
  functionality; if it preserves approved architecture, it is `build`. Route to
  `architecture_review` only when the approved architecture itself must change or be clarified.
- **Keep omissions distinct from decisions.** An in-scope planning omission is a plan miss, not an
  architecture or design decision, so it routes to `plan`; it does not make `architecture_review`
  appropriate.
- **Check plan-task coverage before `plan`.** Before selecting `plan`, examine the approved plan's
  existing tasks. A gap whose remedy is admitted by an existing task is `build`; use `plan` only
  when no existing task admits the remedy.
- **Reject contradictory dispositions.** It is forbidden and invalid to select
  `architecture_review` when no architectural decision is needed; that architecture_review
  disposition is invalid. Route that clear conforming implementation/test/documentation work to
  `build` instead. Conversely, it
  is forbidden and invalid to select `build` when an unresolved or ambiguous architectural decision
  remains; that build disposition is invalid. Use `architecture_review` when approved architecture must change or be clarified, or
  `halt: architectural-clarity` when a human decision is required.

### 4. Output Contract

Write the plan to **`.pipeline/remediation.json`** (run evidence — gitignored, overwritten each run).
The conductor reads this file to route, so the shape is exact:

```json
{
  "dispositions": [
    {
      "id": "FR-10",
      "disposition": "build",
      "category": null,
      "rationale": "kids/[id].tsx:119 reads .data.attributes.name, but apiFetch normalizes to .data.name (api-client.ts:108); the cold-link test mock returns an un-normalized envelope that masks the runtime break.",
      "tasks": [
        {
          "id": "rem-fr10-1",
          "title": "kids/[id].tsx:119 — read kidIdentityQuery.data?.data?.name (the normalized shape), not .attributes.name; realign KidDetailScreen-coldlink mock to the normalized envelope { data: { id, type, name, birthdate }, meta }",
          "status": "pending"
        }
      ]
    },
    {
      "id": "FR-4",
      "disposition": "halt",
      "category": "product-scope",
      "rationale": "The PRD never specified multi-currency wallets; supporting them is new product scope, not a bug — needs a human DECIDE amendment.",
      "tasks": []
    }
  ]
}
```

Field rules:
- `id` — the blocking FR id (`FR-N`); for an as-built finding, the violated ADR id (its filename stem, e.g. `adr-2026-06-29-rate-limit-strategy`); for a finish test failure, `test:<failing file stem>` (e.g. `test:loop-intake`); for a `build_review` trigger gap, `build_review:<stem>` (e.g. `build_review:completeness`); for a stall-question, `stall:<slug>` where `<slug>` is a 1-3 word summary of the question topic (e.g. `stall:validation-layer`, `stall:acceptance-test-fidelity`).
- `disposition` — one of `build` | `acceptance_specs` | `architecture_review` | `plan` | `publication` | `halt`.
  Use `publication` when the shipped code is already correct and the ONLY defect is in what the
  pull request *says* — a placeholder or wrong-template body, a stale title, a missing `Closes`
  reference, prose that describes a superseded approach. It routes to `finish`, which owns PR
  prose. Never route a prose-only gap to `build`: re-opening an implementation phase to run a
  `gh pr edit` is the failure this disposition exists to prevent. Conversely, never use
  `publication` when any code, test, spec, or configuration must change — that is `build`.
- `category` — **only** when `disposition == "halt"`: `architectural-clarity` | `product-scope` | `unanswerable` (stall-question only). Otherwise `null`.
- `rationale` — one sentence citing the gap's `file:line` evidence and justifying the disposition. For a **stall-question with `disposition == "build"`**, the rationale contains the **answer to the question**, grounded in the committed artifacts that support it.
- `tasks` — for a `publication` disposition, tasks are OPTIONAL and purely informational: the
  `rationale` is the remedy, and nothing is ever appended to the plan (see §5). Otherwise:
  **required, non-empty** when `disposition == "build"` (and recommended for `acceptance_specs`/`plan`), EXCEPT for **stall-question answers**, which have `tasks: []` (no further work — the answer in `rationale` is the remedy). Each task is concrete and **file-scoped** (`file:line` + exactly what to change), drawn from the audit evidence. **`[]` for all `halt` dispositions.** A `build` disposition with empty `tasks` is invalid EXCEPT when the input is a `build_stall` stall-question.

Emit one disposition per **blocking** gap. Non-blocking (`ALIGNED` / `ACCEPTED`) FRs are not included.

### 5. Plan-Append Contract

For `build`, `acceptance_specs`, `plan`, and `architecture_review` dispositions, the conductor engine appends each task to the `.docs/plans/{slug}.md` file as a task header for later execution. The append happens at the engine level after remediation completes.

**`publication` and `halt` dispositions are excluded from the append.** `.docs/plans/{slug}.md` is a
protected artifact; amending it from a step that is not authoring the plan raises
"Protected artifact self-amendments detected". A PR-prose fix is not plan work, so the engine
appends nothing for it and re-dispatches `finish` instead.

**Task ID Format:**
- Task IDs must be non-empty and match the grammar: `[A-Za-z0-9._-]+` (alphanumeric, dots, underscores, hyphens)
- **Gate-source prefix is required:** `rem-<category>-<number>` format. Examples:
  - `rem-fr10-1` — remediation for feature request 10
  - `rem-adr-001` — remediation for ADR drift
  - `rem-test-001` — remediation for test failure
- Empty IDs are rejected and cause the remediation to fail
- IDs without the `rem-` prefix trigger a warning but are not rejected (for backward compatibility)

**Appended Headers:**
Each remediation task is appended as a markdown task header:
```markdown
### Task rem-fr10-1: kids/[id].tsx:119 — read kidIdentityQuery.data?.data?.name...
```

Headers re-parse via the Task 18 grammar and must include:
- 1–6 `#` markers (level 1–6 heading)
- The word `Task` followed by the deterministic ID
- A colon `:` and at least one character of title text

**Engine Behavior:**
1. **Validation:** All task IDs are validated before any append occurs
2. **Atomic write:** Appended tasks are written atomically to the plan file (temp file + rename)
3. **Non-empty content:** Titles must be non-empty strings
4. **Prefix warning:** Tasks without `rem-` prefix are logged but not rejected

## Verification

- [ ] Read the blocking gaps from `.pipeline/prd-audit.md` (and `.pipeline/architecture-review-as-built.md` if present), or the stall-question from `.pipeline/build-stall-question.md`
- [ ] One disposition per blocking gap or stall-question — nothing blocking omitted
- [ ] HALT used ONLY for `architectural-clarity`, `product-scope`, or (stall-question) `unanswerable`; every other gap/question routed to a step
- [ ] A gap whose ONLY defect is published PR prose (placeholder/wrong-template body, stale title,
      missing `Closes`) uses `publication`, never `build` — and `publication` is not used for any
      gap that requires a code, test, spec, or configuration change
- [ ] Every `build` disposition (gap) has ≥1 concrete, file-scoped task drawn from the evidence; stall-question answers have `tasks: []` and the answer in `rationale`
- [ ] `category` set iff `disposition == "halt"`; `tasks` empty iff `disposition == "halt"` OR (stall-question answer with `disposition == "build"`)
- [ ] For a stall-question answer (`build_stall` disposition `build`), the `rationale` clearly answers the original question and cites the artifacts that support it
- [ ] A gap requiring another feature's sealed-artifact amendment routes to its owning DECIDE step,
      never to `build` or `acceptance_specs`
- [ ] `id` format correct: `FR-N`, `test:<stem>`, `adr-<stem>`, or `stall:<slug>`
- [ ] Valid JSON written to `.pipeline/remediation.json` matching the contract exactly
