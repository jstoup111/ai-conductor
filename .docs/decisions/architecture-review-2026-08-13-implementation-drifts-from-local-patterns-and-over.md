# Architecture Review: Feature-specific pattern reuse and lowest-sufficient testing

**Date:** 2026-08-13  
**Intake:** jstoup111/ai-conductor#1552  
**Tier:** Medium — lightweight mode (Feasibility + Alignment)  
**Stories reviewed:** none yet — this review runs before `/stories`, against the confirmed technical intent in `.docs/track/implementation-drifts-from-local-patterns-and-over.md`  
**Verdict:** APPROVED

> **Amended 2026-08-17 by #1552:** the verdict is now **APPROVED WITH CONDITIONS**. The original
> APPROVED verdict rested on the assertion that this feature needs no runtime or artifact contract
> change. The zero-acceptance-spec completion contract added below falsifies that assertion, so the
> single condition in `## Conditions` must be met before the feature can finish.

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. The change is shared Markdown guidance in existing skills, agent prompts, and canonical documentation. It adds no package, runtime, service, parser, or configuration schema. |
| **Prerequisites** | The existing exact-replication ADR remains authoritative for `Pattern-source` / `Rename-map`. Issue #1553 owns later `build_review` consumption; #1554 owns project-declared conventions; #1555 owns repository-wide cleanup of existing skill-language tests. None blocks this skill-first change. |
| **Integration surface** | Broad but shallow: DECIDE identifies and carries local pattern context; BUILD consumes it through existing prompt dispatch; test authoring selects the lowest sufficient layer. No new step or artifact type is introduced. |
| **Data implications** | None. The plan’s ordinary technical approach/task prose carries the context. There is no new parsed header, ledger, sidecar, manifest, or migration. |
| **Performance risk** | Low. An implementer reads a small set of current-checkout hints before editing. Avoiding redundant acceptance and mirror-file tests should reduce test-authoring and suite cost. |
| **Worktree isolation** | Clean. All reads resolve in the active feature worktree at current `HEAD`; no shared cache, mutable registry, port, or external resource is introduced. |

> **Amended 2026-08-17 by #1552 (Data implications):** still no new parsed header, ledger,
> sidecar, manifest, or migration, and no committed artifact changes shape. One existing gitignored
> run-evidence artifact does: `.pipeline/acceptance-specs-red.json` gains a required outcome tag so
> the `acceptance_specs` completion gate can tell a legitimate zero-spec outcome from a skipped
> step. See **Zero-acceptance-spec completion contract** under Alignment.

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

> **Amended 2026-08-17 by #1552:** the selection rule above permits an outcome in which no criterion
> earns an acceptance/system spec, but it left the `acceptance_specs` step's completion contract
> undefined for that outcome. `skills/writing-system-tests/SKILL.md:224` tells the step to generate
> no specs and to fabricate no acceptance RED run, while the engine's completion check at
> `src/conductor/src/engine/artifacts.ts:2119-2172` refuses completion when zero spec files exist and
> again when `.pipeline/acceptance-specs-red.json` is missing. As written the two cannot both be
> satisfied, so the accepted rule is unreachable and the step is forced back into generating the
> redundant acceptance specs this feature exists to remove. The contract below resolves that, and a
> new machine-readable seam is therefore expected rather than unexpected — it is tested narrowly at
> that seam, exactly as the paragraph above requires.

#### Zero-acceptance-spec completion contract

The `acceptance_specs` step has exactly two completion outcomes. They are mutually exclusive and
are discriminated by an **explicitly recorded outcome tag**, never by the absence of a file —
absence-based gating is what previously let an unexecuted spec pass for RED.

**Outcome A — `specs-generated`.** Reached whenever at least one criterion is dispositioned
`acceptance-system-spec`, or a `Pattern-source` / `Rename-map` declaration resolves. Its contract is
unchanged and unrelaxed: the spec files exist, `.pipeline/acceptance-specs-red.json` carries genuine
counters from a run that actually executed and failed, `.pipeline/acceptance-specs-run.json` carries
the rerun contract, and the failing specs are committed. **Every copied or generated acceptance spec
keeps its RED proof.** The declared-replication path always resolves to this outcome under
`adr-2026-08-09-declared-pattern-replication-in-build`, including its fail-closed branches: an empty
source set, a target-path collision, and a fully passing copied set each still fail closed and never
fall back to derivation or to Outcome B.

**Outcome B — `disposition-only`.** Reached only when no criterion is dispositioned
`acceptance-system-spec` and no replication declaration resolved. Completion then rests on the
criterion disposition record instead of on spec artifacts: every happy and negative criterion of
every story carries exactly one closed-set disposition with a verifiable citation —
`existing-sufficient-test` citing the test that already asserts the behavior, or
`planned-lower-layer-test` naming the owning plan task and the layer that will prove it. Zero spec
files, an absent run contract, and absent RED counters are the *correct* evidence for this outcome:
the step must not write acceptance RED counters here, and the gate must not accept them.

**The two evidence kinds are distinct and never substitute for one another.** Lower-layer
disposition evidence is a **forward commitment** — it names which test will prove the criterion and
where, and it is discharged later by `/tdd`'s own RED→GREEN cycle under that task's existing rules,
whose proof is that task's test evidence rather than this step's. Generated-spec RED evidence is a
**retrospective observation** — counters from a run that executed and failed. A
`planned-lower-layer-test` disposition therefore never satisfies the RED contract, and a RED run
never excuses a missing or incomplete disposition record.

**One tagged evidence artifact, not a second channel.** The outcome tag and the disposition record
live in the step's existing evidence artifact, `.pipeline/acceptance-specs-red.json`, rather than in
a new sidecar: one gate input, one validator, one way to pass, and the zero-spec case becomes a
positive declaration instead of an inferred absence. The filename is retained because the engine
constant, the acceptance RED runner, and the reference documentation already resolve it; the now
partly inaccurate name is accepted debt, not a reason to open a parallel evidence path.

**What the gate does with it.** `src/conductor/src/engine/artifacts.ts`'s `acceptance_specs`
completion check reads the tag and applies the matching contract: the spec-file-existence and
RED-counter requirements belong to Outcome A; Outcome B completes on a valid, complete disposition
record with zero spec files. Missing, unparseable, mis-tagged, internally inconsistent, or
incomplete evidence remains fail-closed under the existing refusal classes. This narrows *which*
evidence proves completion; it never makes evidence optional, and it removes no existing refusal.
The product-track `.pipeline/fr-coverage.md` FR-coverage gate is unchanged and still applies to both
outcomes.

**Why this one surface needs engine code.** The refusal is the engine predicate “zero spec files
means not done”; no wording in `skills/writing-system-tests` can satisfy it. This is the single
place in #1552 where guidance alone cannot deliver the accepted rule.

### Deterministic-first and provider alignment

Semantic applicability and current-equivalent discovery require judgment, so skill guidance is the correct mechanism. The existing exact-copy case remains mechanical under its approved ADR. This feature does not add deterministic machinery that can validate only path existence while pretending to judge semantic fit.

> **Amended 2026-08-17 by #1552:** this remains true of the semantic-reuse rules, and the feature
> still adds no machinery that pretends to judge semantic fit. It is narrowed for one surface: the
> `acceptance_specs` completion gate is amended in engine code, because the question it answers —
> “did this step record the evidence its own outcome requires?” — is mechanical bookkeeping over a
> declared outcome, not a semantic judgement. The judgement (which layer proves a criterion) stays
> in the skill; only the bookkeeping is deterministic.

All rules are provider-neutral. Host-specific invocation mechanics remain scoped in their existing sections; both supported hosts receive the same plan context, current-checkout expectation, stale-basis behavior, and test-layer rule.

### Documentation

Update the canonical skill/lifecycle and repository testing documentation that explains these contracts. Leave README unchanged because the landing-page contract does not change.

## Wiring Surface

No new callable production surface is introduced. These existing lifecycle surfaces consume the changed guidance through their current invocation paths:

> **Amended 2026-08-17 by #1552:** still no new callable production surface. The zero-spec contract
> changes one existing production surface rather than adding one — the `acceptance_specs` entry of
> the engine's step-completion table (`src/conductor/src/engine/artifacts.ts`), already invoked by
> the conductor's step-completion check on every `acceptance_specs` evaluation, plus the outcome tag
> in the existing `.pipeline/acceptance-specs-red.json` evidence contract that
> `skills/writing-system-tests` already writes and that gate already reads.

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

> **Amended 2026-08-17 by #1552:** the zero-spec completion contract adds these risks.

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The `disposition-only` outcome becomes an escape hatch that skips the step | Technical | Medium | High | Completion requires a complete, citation-bearing disposition record for every happy and negative criterion; an empty or partial record fails closed exactly as missing RED evidence does |
| A step fabricates acceptance RED counters for a zero-spec outcome | Technical | Low | High | The outcome tag is required and the two shapes are mutually exclusive: RED counters under `disposition-only` are a validation failure, not a pass |
| Relaxing the gate lets an unexecuted generated spec pass again | Technical | Low | High | Outcome A's contract is unchanged — spec files, executed counters, run contract, committed specs — and the declared-replication path always resolves to Outcome A |
| The retained `acceptance-specs-red.json` filename misleads a later reader | Knowledge | Medium | Low | The outcome tag is explicit in the artifact and documented with the gate; renaming the constant is deliberately out of scope for #1552 |

## ADRs Created

None. The change introduces no system boundary, component/service decomposition, integration pattern, durable state/data architecture, or foundational technology. It changes shared workflow policy and prompt context, which the governing architecture-review contract explicitly excludes as an ADR trigger.

> **Amended 2026-08-17 by #1552:** still none, re-checked against the structural prerequisite for the
> zero-spec completion contract. It revises the evidence contract of an existing step gate whose
> replication half is already governed by `adr-2026-08-09-declared-pattern-replication-in-build`; it
> establishes no system boundary, no component or service decomposition, no new integration pattern,
> and no foundational technology. It is not durable state or data architecture either:
> `.pipeline/acceptance-specs-red.json` is gitignored per-run evidence, not persisted architecture.
> The structural prerequisite is unmet, so this amendment is itself the recorded decision.

## Conditions

None.

> **Amended 2026-08-17 by #1552:** one condition now applies.
>
> **C1 — the zero-acceptance-spec completion contract ships whole.** The accepted rule that a
> criterion need not become an acceptance spec is not delivered while the `acceptance_specs` gate
> still refuses a zero-spec outcome. Both halves must land together: the outcome tag and
> disposition-record shape in `skills/writing-system-tests/SKILL.md` (§224's zero-spec branch and
> the §6/§7 evidence and verification checklist, which become conditional on the recorded outcome),
> and the matching `acceptance_specs` completion check in
> `src/conductor/src/engine/artifacts.ts:2119-2172` with tests at that seam covering both outcomes
> and each fail-closed refusal. Approved Plan Task 8 currently excludes this contract, so the plan
> must carry it before BUILD can satisfy the condition. Partial delivery — skill wording without the
> gate — leaves the accepted rule unreachable and is not a satisfied condition.

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
