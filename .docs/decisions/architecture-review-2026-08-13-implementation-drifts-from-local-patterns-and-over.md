# Architecture Review: Feature-specific pattern reuse and lowest-sufficient testing

**Date:** 2026-08-13  
**Intake:** jstoup111/ai-conductor#1552  
**Tier:** Medium — lightweight mode (Feasibility + Alignment)  
**Stories reviewed:** none yet — this review runs before `/stories`, against the confirmed technical intent in `.docs/track/implementation-drifts-from-local-patterns-and-over.md`  
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. The change is shared Markdown guidance in existing skills, agent prompts, and canonical documentation. It adds no package, runtime, service, parser, or configuration schema. |
| **Prerequisites** | The existing exact-replication ADR remains authoritative for `Pattern-source` / `Rename-map`. Issue #1553 owns later `build_review` consumption; #1554 owns project-declared conventions; #1555 owns repository-wide cleanup of existing skill-language tests. None blocks this skill-first change. |
| **Integration surface** | Broad but shallow: DECIDE identifies and carries local pattern context; BUILD consumes it through existing prompt dispatch; test authoring selects the lowest sufficient layer. No new step or artifact type is introduced. |
| **Data implications** | None. The plan’s ordinary technical approach/task prose carries the context. There is no new parsed header, ledger, sidecar, manifest, or migration. |
| **Performance risk** | Low. An implementer reads a small set of current-checkout hints before editing. Avoiding redundant acceptance and mirror-file tests should reduce test-authoring and suite cost. |
| **Worktree isolation** | Clean. All reads resolve in the active feature worktree at current `HEAD`; no shared cache, mutable registry, port, or external resource is introduced. |

## Alignment

### Shared precedence rule

`HARNESS.md` will state one consumer-facing rule: approved architecture is authoritative; otherwise, when a suitable established implementation pattern exists and the operator has not authorized a bounded refactor, work reuses that pattern rather than introducing a cleaner-in-isolation alternative. This is a precedence rule, not a universal style catalog.

The rule applies only where a relevant precedent exists. It does not prescribe service objects, repositories, dependency injection, test directory shapes, or any other concrete pattern across projects.

### DECIDE records semantic context, not unstable coordinates

Architecture review will identify applicable precedent by its role and important structural traits. Exemplar paths and symbols are current-checkout search hints only; line references and authoring-time snapshots are forbidden as BUILD handoff anchors. The rationale will explain why the precedent applies and which variation is permitted.

If no suitable precedent exists, or a bounded refactor is operator-authorized, DECIDE records that outcome in ordinary review/plan prose. There is no strict new schema. A short, recognizable “local pattern context” subsection is sufficient when it gives a zero-context implementer enough information to rediscover the current equivalent.

`skills/plan` will carry that focused context into the relevant task or technical approach. It remains distinct from the parsed `Pattern-source` / `Rename-map` exact-copy contract governed by `adr-2026-08-09-declared-pattern-replication-in-build`.

### BUILD resolves against current HEAD

`skills/pipeline` and `agents/generator.md` will include the relevant local pattern context in isolated implementation prompts. The implementer reads the cited hints and nearby current code, resolves the current equivalent, and produces the smallest change that conforms to its semantic traits.

A moved file or renamed symbol is not automatically stale if the semantic equivalent is discoverable on current `HEAD`. If no equivalent remains and the missing precedent changes the implementation approach, the implementer requests context or blocks rather than copying obsolete code, guessing a replacement, or silently widening into a refactor.

`skills/tdd` will replace “simplest passing code” with the smallest behavior-complete, pattern-conforming change. `agents/evaluator.md`, `skills/code-review`, and `skills/simplify` will receive or consult the same focused context and flag only material unapproved departures—not stylistic preferences or harmless variation.

### Tests prove behavior at the lowest sufficient layer

Every happy and negative acceptance criterion remains covered, but a criterion does not automatically become an acceptance/system test. `skills/writing-system-tests` will use its existing coverage-disposition model as the primary decision:

- `already-tested` when an existing behavioral test covers the criterion;
- `unit-covered` when the criterion is sufficiently proven at a unit, request, endpoint, or comparable lower layer;
- `spec-covered` only for a distinct multi-step externally observable flow that cannot be proven sufficiently below.

Negative behavior remains mandatory, but the acceptance layer need not enumerate every permutation already covered below. `skills/tdd` will remove the production-file-to-mirror-spec rule; tests correspond to changed behavior, failure boundaries, and established repository conventions rather than file existence.

For #1552 itself, no new test may pass solely because a skill contains particular natural-language wording. A new machine-readable or executable seam, if implementation unexpectedly introduces one with operator-approved scope, is tested narrowly at that seam. Existing prose-only assertions affected directly by the wording change may be removed when necessary to keep validation honest; the broader inventory remains #1555.

### Deterministic-first and provider alignment

Semantic applicability and current-equivalent discovery require judgment, so skill guidance is the correct mechanism. The existing exact-copy case remains mechanical under its approved ADR. This feature does not add deterministic machinery that can validate only path existence while pretending to judge semantic fit.

All rules are provider-neutral. Host-specific invocation mechanics remain scoped in their existing sections; both supported hosts receive the same plan context, current-checkout expectation, stale-basis behavior, and test-layer rule.

### Documentation

Update the canonical skill/lifecycle and repository testing documentation that explains these contracts. Leave README unchanged because the landing-page contract does not change.

## Wiring Surface

No new callable production surface is introduced. These existing lifecycle surfaces consume the changed guidance through their current invocation paths:

| Changed surface | Existing consumer |
|---|---|
| `HARNESS.md` shared precedence and test-layer rule | Loaded by supported host sessions through project root instructions |
| `skills/architecture-review/SKILL.md` local-pattern discovery | Existing DECIDE architecture-review step |
| `skills/plan/SKILL.md` focused local pattern context | Existing plan authoring step; later read by BUILD and review workflows |
| `skills/pipeline/SKILL.md` isolated prompt context | Existing BUILD pipeline task dispatch |
| `agents/generator.md` current-HEAD rediscovery | Existing generator dispatch from TDD/pipeline |
| `skills/tdd/SKILL.md` pattern-conforming GREEN and behavior-based tests | Existing per-task TDD cycle |
| `skills/writing-system-tests/SKILL.md` coverage dispositions | Existing acceptance-spec step |
| `skills/code-review/SKILL.md` and `agents/evaluator.md` material-departure review | Existing fresh-context evaluator dispatch |
| `skills/simplify/SKILL.md` pattern-aware simplification and low-signal test rejection | Existing pipeline batch boundary |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A path or symbol hint moves before BUILD | Integration | Medium | Medium | Treat hints as search seeds; rediscover semantic traits on current `HEAD`; surface a genuinely missing equivalent as stale context |
| “Applicable pattern” becomes a pretext for subjective style enforcement | Knowledge | Medium | Medium | Require role, traits, and applicability rationale; permit harmless variation; review only material departures |
| A local code pattern conflicts with approved architecture | Technical | Low | Medium | Preserve the existing authority order: approved ADR first, observed code second |
| Test minimization becomes under-testing | Technical | Medium | Medium | Keep one coverage disposition per criterion and require negative behavior at the lowest sufficient layer |
| Semantic reuse is confused with exact replication | Integration | Low | Medium | Keep ordinary “local pattern context” prose separate from parsed `Pattern-source` / `Rename-map`; cite the governing ADR |
| Later #1553 invents a second evidence shape | Integration | Low | Medium | Make the plan’s focused context readable by later review without changing any `build_review` surface in #1552 |

## ADRs Created

None. The change introduces no system boundary, component/service decomposition, integration pattern, durable state/data architecture, or foundational technology. It changes shared workflow policy and prompt context, which the governing architecture-review contract explicitly excludes as an ADR trigger.

## Conditions

None.

## Blocking Issues

None.

## Advisory Overlap Scan

The required file-overlap scan reported matches against nearly every retained spec branch because
the input is a set of shared lifecycle files that many prior plans name. That report is not a clean
result, but it is low-signal rather than evidence of a concrete conflict. The substantive related
surfaces were checked directly: the approved exact-replication design remains distinct and
authoritative for its parsed contract, and #1553's `build_review` work is deliberately excluded.
No blocking overlap was identified; `/conflict-check` will still judge the authored stories before
planning.
