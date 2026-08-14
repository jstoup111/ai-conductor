# Conflict Check: feature-specific pattern reuse and lowest-sufficient testing

**Date:** 2026-08-13  
**Issue:** jstoup111/ai-conductor#1552  
**Stories scanned:** `.docs/stories/implementation-drifts-from-local-patterns-and-over.md`
(Stories 1–4), plus the repository story/spec/conflict corpus  
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml:82`)  
**Result:** PASSED after resolution — 4 blocking conflicts found and resolved, 0 degrading
conflicts, 0 conflicts remaining

## Corpus selection

All 330 story files, 49 spec files, and 194 prior conflict reports were inventoried; stories whose
subjects overlap architecture authority, pattern handoff, TDD, acceptance-spec generation, or
review were read in full. All 274 ADR-shaped files were inventoried by status and subject; 250 have
an approval marker in their opening status block.

**Examined in full** because their approved decisions overlap this feature:

| ADR filename stem | Subject overlap |
|---|---|
| `adr-2026-06-29-architecture-before-stories-convergent-kickback` | DECIDE order and story-phrasing conflict routing |
| `adr-2026-07-12-wired-into-contract` | Existing architecture-decides/plan-carries precedent |
| `adr-2026-07-21-engine-owned-acceptance-red-execution` | RED execution for generated acceptance specs |
| `adr-2026-07-21-s-tier-pipeline-knobs` | One pipeline and unchanged safety/evidence gates |
| `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` | Provider-neutral shared skill contract |
| `adr-2026-08-01-engine-owned-scoped-test-invocation` | Lower-layer scoped test execution |
| `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` | RED evidence for acceptance specs that are generated |
| `adr-2026-08-09-declared-pattern-replication-in-build` | Existing parsed exact-copy contract |
| `adr-2026-08-13-markdown-default-inversion` | Skills and agent Markdown are runtime source |

**Narrowed out:** approved ADRs about daemon lifecycle, parking, intake, release/publication,
provider credentials/routing, telemetry, worktree deletion, rebase mechanics, model policy, and
unrelated gate internals. Their subjects do not address pattern selection/handoff, TDD test scope,
or acceptance-spec derivation. No selected ADR was excluded on supersession grounds; partial or
ambiguous supersessions remained in the inventory.

## BLOCKING

### Conflict 1: the legacy TDD story requires a mirror spec for every production file

**Stories involved:** `features/tdd/ST-019` vs Story 4  
**Files:** `.docs/stories/features/tdd/ST-019-red-green-cycle.md` vs
`.docs/stories/implementation-drifts-from-local-patterns-and-over.md`  
**Type:** contradiction  
**Severity:** blocking  
**Confidence:** 100%, verified against both accepted story texts

The legacy story requires:

> Given a file is created in `app/` (or equivalent), when the spec coverage check runs, then a
> corresponding spec file must exist — every production file gets a spec

Story 4 requires:

> Given production code changes across one or more files without introducing separate behavioral
> boundaries, when test scope is chosen, then no mirror test is required solely to correspond to
> each production file.

Both directions fail. Enforcing the legacy coverage gate violates Story 4; accepting Story 4 leaves
the legacy Done-When item false. BUILD would alternate between adding a no-behavior mirror spec and
removing it as redundant.

**Resolution Options:**

1. Additively amend `ST-019` so changed behavior and failure boundaries, not production-file count,
   govern test scope; preserve the RED/DOMAIN/GREEN cycle and all behavioral RED requirements.
2. Remove Story 4's no-mirror rule and retain the legacy one-file/one-spec gate.
3. Defer the contradiction to project convention configuration under #1554.

**Recommendation:** Option 1. It directly delivers #1552 without weakening TDD's behavioral RED
contract; Option 2 preserves the reported defect, and Option 3 moves a shared harness contradiction
into an explicitly separate future problem.

### Conflict 2: the legacy acceptance-spec story generates one high-layer test per criterion

**Stories involved:** `features/writing-system-tests/ST-018` vs Story 4  
**Files:** `.docs/stories/features/writing-system-tests/ST-018-acceptance-spec-generation.md` vs
`.docs/stories/implementation-drifts-from-local-patterns-and-over.md`  
**Type:** contradiction  
**Severity:** blocking  
**Confidence:** 100%, verified against both accepted story texts

The legacy story requires:

> Given accepted stories exist with Given/When/Then criteria, when the skill runs, then it
> generates one failing test per acceptance criterion (happy + negative paths)

and maps every API/full-stack case directly to request/integration or system/e2e specs. Story 4
instead requires a concrete coverage disposition per criterion, keeps single behavior at a
sufficient lower layer, and reserves acceptance/system coverage for a distinct multi-step flow.

Both directions fail. Fully satisfying `ST-018` creates the redundant high-layer tests Story 4
forbids; fully satisfying Story 4 makes `ST-018`'s one-spec-per-criterion Done-When item false.

**Resolution Options:**

1. Additively amend `ST-018` to require one coverage disposition per criterion, with generated
   acceptance/system specs only for distinct multi-step externally observable flows; retain RED
   evidence for every spec that is generated.
2. Remove Story 4's lowest-sufficient-layer rule and retain one acceptance spec per criterion.
3. Add a strictness/configuration mode deciding which rule applies.

**Recommendation:** Option 1. It aligns the legacy story with the already-accepted
`writing-system-tests-fr-coverage` three-disposition model. Option 2 preserves the reported defect;
Option 3 introduces the project-policy surface deliberately split to #1554.

### Conflict 3: the global test-layer wording could override declared exact-copy replication

**Stories involved:** Story 4 vs ADR: declared pattern replication  
**Files:** `.docs/stories/implementation-drifts-from-local-patterns-and-over.md` vs
`.docs/decisions/adr-2026-08-09-declared-pattern-replication-in-build.md`  
**Type:** behavioral overlap  
**Severity:** blocking  
**ADR filename stem:** `adr-2026-08-09-declared-pattern-replication-in-build`  
**Story ID:** Story-4  
**Confidence:** 90%, verified; the collision occurs when a declared source contains a single-step
acceptance spec

**ADR opposing sentence (verbatim):** "`acceptance_specs` copies rather than derives. The source
feature's acceptance specs are copied and renamed."

**Story opposing sentence (verbatim):** "Acceptance/system coverage is reserved for distinct
multi-step externally observable flows"

If exact-copy replication inherits an existing single-step acceptance spec, the ADR requires the
copy while Story 4's unqualified Done-When wording forbids that acceptance-layer coverage. The
approved architecture for #1552 already says the exact-copy contract is unchanged, so this is a
story-scope ambiguity rather than a design gap.

**Resolution Options:**

1. Amend Story 4 to state that its classification governs ordinary derivation; a valid declared
   exact-copy replication continues copying source specs under its governing ADR.
2. Re-open the exact-replication ADR and require copied specs to be reclassified before copying.
3. Leave the two rules unqualified and let BUILD infer precedence.

**Recommendation:** Option 1. It preserves the explicit #1552 boundary, avoids changing parsed
`Pattern-source` / `Rename-map` behavior, and prevents BUILD from guessing.

## Clean interactions

Every pair among Stories 1–4 that shares a behavior was tested in both directions:

- Story 1 establishes a basis and Story 2 consumes it; the no-fit/departure branches are explicit,
  so neither assumes the other always has an exemplar.
- Story 2's smallest pattern-conforming implementation and Story 3's material-drift review are
  reinforcing. Harmless variation remains allowed in both.
- Story 4 changes coverage selection, not RED validity for specs that are actually generated; the
  two acceptance-RED ADRs remain fully operative.
- Runtime-source classification of skill Markdown does not require natural-language substring
  tests. `adr-2026-08-13-markdown-default-inversion` and Story 4 can both be fully satisfied.
- Provider-neutral shared behavior is consistent with the first-class Codex ADR.

No resource contention, sequencing conflict, state conflict, or unresolved oscillation was found
outside the three contradictions above.

## Required operator resolution

The operator selected Option 1 for Conflicts 1–3. The accepted artifacts now carry additive
amendments beside each superseded assertion:

- `ST-019` no longer requires a mirror spec per production file;
- `ST-018` uses one lowest-sufficient coverage disposition per criterion;
- Story 4 explicitly leaves declared exact-copy replication under its governing ADR.

The first re-check confirmed those three contradictions no longer reproduce in either direction.
It also exposed one additional legacy assertion that must be resolved before planning.

### Conflict 4: literal minimum-to-green can still violate an applicable pattern

**Stories involved:** `features/tdd/ST-019` vs Story 2  
**Files:** `.docs/stories/features/tdd/ST-019-red-green-cycle.md` vs
`.docs/stories/implementation-drifts-from-local-patterns-and-over.md`  
**Type:** behavioral overlap  
**Severity:** blocking  
**Confidence:** 95%, verified against both accepted story texts

The legacy story requires:

> Given the test is verified, when GREEN phase runs, then the minimum code to make the test pass is
> written — no extras, no refactoring

Story 2 requires:

> Given the current equivalent is found, when the behavior is implemented, then the result is the
> smallest behavior-complete change that conforms to the applicable semantic traits.

A smaller parallel abstraction can satisfy the immediate test while violating the applicable
pattern. Fully satisfying the literal legacy rule accepts that smaller implementation; fully
satisfying Story 2 may require structure the test alone does not force. The rules therefore give
GREEN and review different definitions of completeness.

**Resolution Options:**

1. Additively amend `ST-019` so GREEN writes the smallest behavior-complete, pattern-conforming
   change. Preserve “no extras” as a prohibition on unrelated behavior and preserve the rule that
   refactoring occurs only when separately authorized and scheduled.
2. Remove Story 2's pattern-conformance requirement and let passing the immediate test define the
   maximum GREEN scope.
3. Keep both unqualified and rely on later review to reject what TDD explicitly accepted.

**Recommendation:** Option 1. It makes TDD and review use one completion definition without
authorizing cleanup or broad refactoring. Option 2 removes the core #1552 behavior; Option 3 creates
a predictable GREEN→review kickback loop.

**Operator selection:** Option 1, qualified so conformance applies when an applicable pattern basis
exists. A verified no-fit result or an operator-authorized bounded departure remains valid.

**Applied:** `ST-019` now defines GREEN as the smallest behavior-complete change conforming to an
applicable recorded basis, while explicitly preserving the approved no-fit/departure branches and
forbidding unrelated extras or an unplanned refactor.

## Re-check status

The full scan was repeated after all four additive amendments. Conflict 4 no longer reproduces:
TDD and review use the same conditional basis, and the no-fit/departure branches are identical to
Story 1's accepted scope. The amendment introduced no conflict with batch-boundary refactoring,
exact replication, or the lowest-sufficient-layer rule.

**Conflict check passed: zero blocking conflicts and zero degrading conflicts remain.**
