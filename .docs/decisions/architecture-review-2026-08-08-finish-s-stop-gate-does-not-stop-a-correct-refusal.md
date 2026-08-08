# Architecture Review: FINISH refusal reaches the operator with its reason

**Date:** 2026-08-08
**Mode:** design-time, lightweight (tier M — Sections 2 and 4 only)
**Track:** technical (no PRD; review input is the explore output and technical intent)
**Stories reviewed:** none yet — this review runs BEFORE `/stories`, per
adr-2026-06-29-architecture-before-stories-convergent-kickback
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. Pure TypeScript inside `src/conductor/`. No new package, no external service, no infrastructure change. |
| **Prerequisites** | None. No migration, no config key, no external account. |
| **Integration surface** | Two modules (`finish-publication.ts`, `finish-pr-prose-judgment.ts`) plus one `SKILL.md`. `conductor.ts` is deliberately untouched — see Alignment. Well under the 3-module flag. |
| **Data implications** | None. No schema, no durable artifact added. Option C's `.pipeline/finish-blocker.json` was rejected partly to keep this true. |
| **Performance risk** | None. The rendering is a map lookup and string concatenation on an already-terminal path. |
| **Worktree isolation** | No new port, service, database, queue, or shared file. `.pipeline/HALT` is already per-worktree. Two worktrees cannot collide on anything this feature introduces. |

**Verified claims** (confidence and basis, per `/verify-claims`):

- `PUBLICATION_CONDITIONS` exists as a `{ message, nextAction }` map in the same module — **verified,
  ~99%** (read at `finish-publication.ts:406-443`).
- `isExactDisposition`'s `human_required` arm is an exact-key guard `hasOnly('kind', 'reason')` —
  **verified, ~99%** (read at `finish-publication.ts:620-624`).
- The conductor writes `route.reason` verbatim into the halt marker — **verified, ~99%**
  (`conductor.ts:5712-5719`).
- `daemon-rekick.ts` already refuses to re-kick a `needs-human` halt, so routing needs no change —
  **verified, ~95%** (`daemon-rekick.ts:186`).
- `/finish` is dispatched with zero arguments, making `SKILL.md` the provider's only instruction
  source — **verified, ~95%** (`skill-invocation.ts:49`).
- The `{"kind": ...}` verdict vocabulary appears nowhere outside `finish-publication*.ts` and its
  tests — **verified, ~90%** (repo-wide grep excluding `node_modules` and `dist-versions`).
  Residual risk: a provider-level system prompt outside the searched paths could inject it. Impact
  if wrong: Finding 2 below is moot and the SKILL.md change is redundant but harmless. Confirm by
  inspecting the assembled provider prompt for one real FINISH dispatch.

**Surfaced assumption, operator-approved at review:** that reachability may depend on provider
compliance with a documented contract rather than on machinery. Approved as an accepted cost; see
Condition 2 and ADR Consequences.

## Alignment

**Pattern consistency — PASS.** `HUMAN_REQUIRED_REASONS` deliberately mirrors the resident
`PUBLICATION_CONDITIONS` shape. No new pattern is introduced, so no departure needs justifying.

**Exhaustive matching — CONDITION 1.** The repository's domain-integrity stance rejects catch-all
defaults on domain states. `PublicationDisposition.human_required.reason` is typed `string`
(`finish-publication.ts:396`) while the inner judgment union at `:926` is closed. A map keyed on
`string` receives no exhaustiveness checking, so a future reason token would render an empty halt —
precisely the failure this feature exists to eliminate, reintroduced one token later. **Condition:**
narrow the field to the closed 12-token union so the map is exhaustive by construction, and retain a
fail-closed generic rendering for a token that still fails to resolve at runtime. Both are required:
the compiler check prevents the omission; the runtime fallback covers the `unknown` boundary that
`isExactDisposition` accepts by design for future adapters.

**Domain boundaries — PASS, and improved.** The review moved the rendering into
`routeFinishPublicationDisposition`'s `human_required` arm rather than exposing a new export for the
conductor to call. Halt-text composition is publication-domain knowledge and belongs beside the
disposition union, not in the conductor. Consequence: `conductor.ts` needs no change, and the
production wiring surface stays at the one caller that exists today.

**State management — PASS.** No boolean flag is introduced where an enum belongs; Condition 1 in
fact moves an existing `string` toward a closed union. `detail` is optional-and-non-empty-when-present
rather than nullable-and-meaningful-when-empty, so no invalid state becomes representable.

**Design Principle (deterministic machinery over prompt discipline) — CONDITION 2.** `CLAUDE.md`
directs that prompt-level rules never substitute for machinery. Publishing the verdict contract in
`SKILL.md` is prompt discipline. It is accepted here because the failure mode is already safe:
`decodePrProseJudgment` fails closed, so a non-compliant provider degrades to a halt carrying a
generic reason and never to a false pass. The cost is a less precise halt reason, never an unsound
one. **Condition:** record this explicitly in the ADR as an accepted cost, to be superseded if a
machinery-only route to reachability appears.

**Security boundaries — N/A.** No new endpoint, no authentication surface, no user input crossing a
trust boundary. `detail` is provider-authored text written into an operator-read local file; it is
never interpolated into a shell command, a URL, or a git operation. The plan should nonetheless bound
its length so a runaway provider cannot author an unreadable halt marker.

**Production DI defaults — N/A.** No in-memory store is registered as a production default; this
feature adds no stateful component.

**Diagram accuracy — PASS.** `.docs/architecture/finish-s-stop-gate-does-not-stop-a-correct-refusal.md`
was authored in this DECIDE pass, renders clean under `conduct render-diagrams --check`, and marks
every changed surface NEW or WIDENED. It reflects the refined design (rendering inside the router).

## Wiring Surface

Design-time commitments for each new production surface. No `file:line` citation is expected yet —
the code does not exist. The SHIP-time as-built sweep verifies actual callers independently.

| New surface | Where it is called from in production |
|---|---|
| `HUMAN_REQUIRED_REASONS` (module-private const) | Read by the halt-rendering helper in the same module; not exported. |
| Halt-rendering helper (module-private) | Called from `routeFinishPublicationDisposition`'s `human_required` arm in `finish-publication.ts` — the sole call site. |
| `routeFinishPublicationDisposition` (existing export, changed output) | Already called from the conductor's FINISH route handling (`conductor.ts`, the `step.name === 'finish' && result.publicationDisposition !== undefined` block). No new wiring. |
| `detail` field on the `human_required` disposition | Produced by `mapPrProseJudgmentResult` for `refused` and `revision_required`; consumed by the rendering helper above. |
| PR-prose verdict contract in `skills/finish/SKILL.md` | Reaches the provider through the existing `skill-resolver.ts` / `skill-invocation.ts` dispatch of `/finish`. No new wiring. |

Every surface terminates at a caller that exists today. This feature introduces **no** new production
entry point, which is why `conductor.ts` is unmodified.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Provider does not emit the documented JSON verdict, so `refused` stays unreachable | Integration | Medium | Medium | Already fails closed — `decodePrProseJudgment` degrades to `revision_required/structurally_incomplete` → halt. Worst case is a generic reason, never a false pass. Recorded as an accepted cost (Condition 2). |
| Widening `isExactDisposition` admits a malformed disposition | Technical | Low | High | Keep `detail` optional, `string`, and non-empty when present; add a rejection test per malformed shape. The guard is the last line before a halt is trusted. |
| An unrecognized reason token renders a blank halt | Technical | Low | Medium | Condition 1: closed union for a compile-time guarantee plus a runtime fail-closed generic rendering. |
| Rebase conflict on `finish-publication.ts` | Knowledge | High | Medium | Advisory `overlap-scan` reports ~29 unmerged spec branches declaring this file. Unavoidable and not caused by this design; noted so the build expects it. Prefer additive edits and keep the diff tight. |
| Provider-authored `detail` bloats the halt marker | Technical | Low | Low | Bound `detail` length at the boundary; specify the cap in the plan. |

## ADRs Created

- `adr-2026-08-08-finish-human-required-halt-rendering` — **APPROVED** by the operator at this
  review. Records Option A over Options B and C, both attached conditions, and the accepted cost of
  provider-contract reliance.

No existing ADR is superseded. No existing APPROVED ADR is violated by this design.

## Conditions

1. **Closed reason union plus fail-closed rendering.** Narrow
   `PublicationDisposition.human_required.reason` from `string` to the closed 12-token union so
   `HUMAN_REQUIRED_REASONS` is compiler-exhaustive, AND retain a generic rendering for a token that
   fails to resolve at runtime. Satisfying only one of the two does not meet this condition.
2. **Accepted-cost record.** The ADR must state that reachability depends on provider compliance
   with a documented `SKILL.md` contract, why that is acceptable (fails closed, never a false pass),
   and that a machinery-only route supersedes it. Recorded.
3. **Documentation upkeep in the same PR.** The operator-visible halt text changes, so
   `docs/runbooks/stalled-or-stuck-feature.md` and `docs/reference/steps.md` must be updated in the
   same PR, per `CLAUDE.md`'s Documentation Upkeep rule.

   > **Amended 2026-08-08 by #1107:** the requirement stands, but its *owner* is the repository's
   > `maintain-documentation` custom step, not the implementation plan. `/plan`'s documentation
   > boundary forbids authoring plan tasks for project documentation even when it accompanies
   > functional work, and `CLAUDE.md` scopes the plan-task form of this rule to consumer projects
   > "without this custom-step configuration" — which this repository is not. The condition is
   > therefore satisfied by the custom step during the same PR, and `.docs/plans/` carries no
   > documentation task. Amended after `/plan` surfaced the collision between the two rules.

Conditions are tracked into `/plan` and are blocking at `/finish` if unmet.

## Notes

**Early overlap scan (advisory only — never blocks this verdict).** `conduct-ts overlap-scan` over
the Wiring Surface paths reports roughly 29 unmerged `origin/spec/*` branches declaring
`src/conductor/src/engine/finish-publication.ts`. Surfaced so `/plan` does not lock in a task
breakdown that assumes an uncontended file. Caveat carried from the tool: renames and name-only
diffs may not be detected.
