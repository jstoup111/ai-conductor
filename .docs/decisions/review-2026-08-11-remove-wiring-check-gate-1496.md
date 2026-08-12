# Architecture Review: Move wiring judgement into build_review (#1496)

**Date:** 2026-08-11
**Mode:** design-time, lightweight (Medium tier — Sections 2 and 4 only)
**Source issue:** jstoup111/ai-conductor#1496
**Reviewed:** `.docs/architecture/2026-08-11-remove-wiring-check-gate.md`,
`.docs/track/per-task-wired-into-contracts-cost-build-cycles-th.md`,
`.docs/complexity/per-task-wired-into-contracts-cost-build-cycles-th.md`
**Verdict:** APPROVED WITH CONDITIONS

Stories do not exist yet — this review runs before `/stories`, per
`adr-2026-06-29-architecture-before-stories-convergent-kickback`. Its input is the technical intent
from `/explore` plus the verified findings recorded in
`adr-2026-08-11-wiring-judged-in-build-review`.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. Deletion plus one rubric item on an existing LLM-judged gate and one new `ConductorEvent` variant. |
| Prerequisites | None. Retaining `wiring_check` as a no-op means no ordering constraint between compatibility work and deletion — the hazard class does not arise. |
| Integration surface | Three modules deleted; ~14 edited. Two edits carry real logic: `build-review-prompt.ts` (fifth rubric item, all-or-FAIL count, verdict schema) and `conductor.ts` (removing the `wiring_check → build` kickback route at 5 sites). The rest remove entries that assume the step does work. |
| Data implications | `.pipeline/build-review.json` gains a `wiring` rubric key and a `findings.wiring` key. `.pipeline/wiring-evidence.json` is no longer written. `conduct-state.json` and `settings.json` are untouched — the step name survives. |
| Performance risk | Net reduction. The probe (a `git grep` per new export plus a TypeScript program build for Layer 2) disappears; `build_review` gains one rubric item over a diff it already reads, with no new dispatch. |
| Worktree isolation | Unaffected. |
| Circular-import hazard | **Improved.** The documented ESM cycle between `wired-into.ts` and `plan-task-parse.ts` (`wired-into.ts:1-12`, with a lazily-built constant specifically to survive both import orderings) is deleted with the modules. |

**Feasible.** No blocking technical obstacle.

## Alignment

**Deterministic-where-possible (CLAUDE.md design principle).** This is the review's most contested
point and it is resolved in the ADR rather than waved past. The change replaces deterministic
machinery with LLM judgement, which reads as a violation on its face. The justification is Finding 3:
the deterministic gate was not deterministically measuring the property it claimed. It gates on "is
this symbol referenced from outside its defining file", which any compliance-shaped edit satisfies,
and which `simplify` — running at every batch boundary *before* the gate — actively churns. The
principle prefers machinery when the mechanical proxy is faithful; here it was not, and 4-in-5 of the
gate's observed failures were authoring notation rather than dead code. The principle's own stated
justification ("instant, token-free, fails at the point of violation") never held for this gate.

**Event spine.** Checked via `.agents/skills/event-spine/SKILL.md` before the design was fixed. The
deprecation notice is a channel and an occurrence, so it becomes a `ConductorEvent` variant rather
than a `log()` line — a bare log would be invisible to the daemon renderer, the UI subscriber, and
the OTel exporter. Verdict recorded in `adr-2026-08-11-deprecated-no-op-step-retirement`. No sidecar,
no stamped artifact, no second reader path. The parallel-member unions at `types/events.ts:489,500`
need no change, since the step name survives.

**Scope placement.** Consumer-facing, not repo-only. The deciding test in CLAUDE.md is whether the
mechanism exists outside this repository — `wiring_check` is an engine step consumer projects run and
configure, and `**Wired-into:**` is a documented plan convention in the shipped `skills/` catalog.
Consequences: `HARNESS.md` is the behavioral-rule home, and the release disposition is
`Removed` / `major` for the deleted CLI subcommand and plan convention.

**Pattern consistency.** The rubric item follows the existing four items' shape exactly — one boolean
in `rubric`, one array in `findings`, subject to the same all-or-FAIL rule. No new verdict format, no
second grader, no new retry discipline.

**State management.** The no-op retention is the representable-states-correct choice: a step is live,
deprecated, or absent, and the change moves `wiring_check` one state along rather than jumping to
absent while live state still names it.

**Security boundaries.** No new endpoint, input, or credential path. Deleting `resolveWaiverRef`
removes a `gh` call path (issue-form waiver resolution) — surface reduction.

## Wiring Surface

Required for Medium tier. This feature introduces very little new production surface.

| New surface | Called from in production |
|---|---|
| The `wiring` rubric item text in `build-review-prompt.ts` | Rendered into the prompt built by the existing `build_review` prompt builder, which `step-runners.ts` dispatches; no new call path. |
| The `wiring` key on the verdict schema | Written by the grader into `.pipeline/build-review.json`; read by the existing `build_review` verdict parser and its all-or-FAIL evaluation in `conductor.ts`. |
| New `ConductorEvent` variant for the deprecation notice | Emitted by the no-op `wiring_check` step through the existing `ConductorEventEmitter`; consumed by `EventPersister` → `.pipeline/events.jsonl` and rendered by the existing `renderDaemonEvent` switch in `daemon-cli.ts`. |

Everything else is deletion and has no wiring surface. Noted deliberately: this section is the
design-time precursor `/plan` used to derive `**Wired-into:**` lines, and it survives the change —
the design-time commitment was never what cost build cycles.

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | The wiring rubric item is non-deterministic; the same diff can be judged differently across runs, producing both false positives and false negatives where the probe was at least consistent. | **High** | Accepted as the core trade. Fallback if the grader proves unreliable is demoting the item to advisory, **not** restoring the probe — recorded in the ADR so a future reader does not re-litigate. |
| R2 | Five all-or-FAIL rubric items means one flaky wiring judgement fails the entire review, including work that passed the other four. | Medium | Inherent to the all-or-FAIL design. Worth watching in the first builds after landing; the R1 fallback covers it. |
| R3 | The rubric item collides with the prompt's existing disclaimer, *"You are not evaluating runtime behavior (that is manual_test's mandate)"* (`build-review-prompt.ts:42-44`), and the grader refuses or waffles. | Medium | C1: the item must be worded as a **static** property of the diff — is the new surface called from a path reaching a production entry point — not as runtime behavior. |
| R4 | `**Files:**` lines are cleaned up as "wiring-related" and break three live consumers: `plan-protected-targets.ts:23` (protected-artifact seal), `autoheal.ts:541`, `remediation-append.ts:63`. | **High** | C2: `parsePlanTaskPaths` and the `**Files:**` convention are explicitly out of scope. Only `WIRED_INTO_LINE` leaves `plan-task-parse.ts`. |
| R5 | Older `.pipeline/build-review.json` verdicts lack the `wiring` key and are read as passing. | Medium | C3: absent key reads as "not judged", never as pass. |
| R6 | A vestigial no-op step confuses readers of step listings and dashboards indefinitely. | Low | Accepted; ADR follow-up files the hard-deletion issue. |
| R7 | Test fallout is broad — 6 test files deleted and ~30 acceptance tests reference `wiring_check` incidentally (step lists, parallel-group membership, state shapes). Retaining the step name shrinks this substantially versus deleting it, but it is still large. | Medium | Budgeted explicitly as plan tasks, not treated as incidental cleanup. |

## ADRs Created

Both are pending operator approval; neither is authoritative until approved.

1. `adr-2026-08-11-wiring-judged-in-build-review` — the core decision. Deletes the probe and contract
   layers and moves reachability judgement into `build_review` as a fifth rubric item. Records the
   three findings, including the correction to #1496's false premise that SHIP sweeps reachability at
   every tier, and the deterministic-principle argument.
2. `adr-2026-08-11-deprecated-no-op-step-retirement` — retains `wiring_check` as a deprecated no-op
   and establishes the two-phase contract for retiring any engine step: strip the machinery first,
   delete the name later once nothing live references it. Binds future step removals, not just this one.

## Conditions

- **C1 (rubric wording).** The wiring item MUST be phrased as a static property of the diff, not as
  runtime behavior, so it does not contradict `build-review-prompt.ts:42-44`. See R3.
- **C2 (scope fence).** `parsePlanTaskPaths` and the `**Files:**` per-task convention are OUT of
  scope and MUST NOT be removed. See R4.
- **C3 (verdict compatibility).** A `.pipeline/build-review.json` lacking the `wiring` key MUST read
  as "not judged", never as a silent pass. See R5.
- **C4 (documentation).** `skills/plan/SKILL.md` (§5c and the task template), `HARNESS.md`,
  `docs/explanation/gates.md`, `docs/reference/steps.md`, `docs/reference/cli.md`,
  `docs/reference/skills.md`, and `docs/contributing/validation.md` are stale on merge unless updated
  in the same PR. `skills/architecture-review/SKILL.md` §12 keeps its sweep unchanged but gains a
  citation to ADR 1.
- **C5 (release metadata).** `Release-Disposition: note`, `Release-Category: Removed`,
  `Release-Semver: major` — the `validate-wired-into` subcommand and the `**Wired-into:**` plan
  convention are both consumer-visible removals. A `## Migration` block is advisory here rather than
  correctness-critical, since the no-op retention keeps existing config working.
