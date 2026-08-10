# Coherence: Provenance-based protected-artifact seal rotation (#1229)

**Date:** 2026-08-09
**Tier:** M
**Track:** technical — no PRD exists, so the `fr` row class is omitted rather than given placeholder
verdicts. The requirement axis is carried by the approved decision records, traced in prose below
the table.

Outcome ids are the five Desired-outcome bullets of `jstoup111/ai-conductor#1229`, in bullet order.
Every verdict below was confirmed by reading the counterpart artifact file, not inferred from a
plausible id.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-8 | covered | Seal valid against the resulting HEAD with no manual JSON edit or reseal. story-1 asserts the permitted rotation advances `baselineCommit` to HEAD with fingerprints matching HEAD's content; story-8 asserts the advance happens with no hand-edited JSON and no reseal command. Scope note: when the base tip is unresolvable the seal is deliberately left unrotated (story-5, story-8 third negative) — verification still passes and no operator action is required, so the outcome's no-intervention intent holds. |
| outcome | outcome-2 | story-1, story-6 | covered | A base-only addition never reported as feature-authored. story-1's second negative path asserts no refusal carrying a feature-authored classification is emitted for a base-ahead path; story-6 requires the emitted classification be derived from resolved provenance rather than from the refusal condition alone. |
| outcome | outcome-3 | story-2, story-5, story-8 | covered | Genuine violations still halt. story-2 covers a committed feature-authored change and a committed deletion; story-5's negative paths keep `workspace-differs-from-head` and provenance-confirmed feature-authored refusals escalating; story-8's first two negative variants assert the halt still occurs against real git fixtures. |
| outcome | outcome-4 | story-6 | covered | Triage distinguishes a stranded seal from a genuine change and reports the classifying evidence. story-6 requires the merge-base commit and the per-path authorship indication on the refusal event, the base-ahead path list on the rebaseline event, and a rendered daemon line for both. |
| outcome | outcome-5 | story-8 | covered | The reproduced sequence completes untouched. story-8's happy path builds the incident fixture — rebase completion, base-only protected-artifact advance, resume — and asserts verification passes with no `HALT` or `HALT.class` marker written. |
| story | story-1 | task-3 | covered | Base-ahead exclusion. task-3 implements the exclusion and asserts the path is absent from the returned blocking `paths`. |
| story | story-2 | task-1, task-4, task-5 | covered | Feature-authored divergence still refuses. task-1 pins the pre-change decision table, task-4 re-scopes the single existing assertion the corrected predicate invalidates, task-5 implements the authored refusal including the deletion and mixed-set cases. |
| story | story-3 | task-2, task-7 | covered | Indeterminate provenance fails closed. task-2 lands the fail-closed branch and the omitted-entry default at the pure level; task-7 maps the degraded no-merge-base and failed-diff probe outcomes to indeterminate. |
| story | story-4 | task-6, task-8 | covered | Authorship resolved outside the pure evaluator. task-6 implements wrapper-side resolution and asserts the pure evaluator stays synchronous with no `execa` call or git helper import; task-8 asserts the ancestor short-circuit and non-diverging paths perform zero probes. |
| story | story-5 | task-9, task-10 | covered | Narrow non-escalation. task-9 widens the non-escalation set to the environmental classes; task-10 proves `workspace-differs-from-head` and provenance-confirmed feature-authored refusals still escalate and that a failing inspection keeps its own reason. |
| story | story-6 | task-11, task-12, task-13, task-14 | covered | Telemetry carries classifying evidence. task-11 adds the refusal evidence fields, task-12 the base-ahead path list, task-13 the daemon renderer, task-14 the throwing-observer tolerance and the no-new-channel assertion. |
| story | story-7 | task-15 | covered | Audit paths cover every protected directory. task-15 replaces the hardcoded directory list with the exported constant and adds a drift guard that fails if the two diverge. |
| story | story-8 | task-16, task-17 | covered | Incident reproduction. task-16 builds the fixture and asserts recovery; task-17 adds the two genuine-violation variants plus the unresolvable-base-ref variant. |
| task | task-1 | story-2 | covered | Typed `infrastructure`; cites story-2 and serves it by pinning the decision table's current verdicts before the predicate changes, so any unintended regression in story-2's refusal behavior is caught. |
| task | task-2 | story-3 | covered | Implements story-3's happy path — an indeterminate authorship value refuses — and its omitted-entry negative path. |
| task | task-3 | story-1 | covered | Implements story-1's two happy paths: a base-tip-only path and a differing-content path, both not-authored, are permitted and excluded from the blocking set. |
| task | task-4 | story-2 | covered | Typed `refactor`; cites story-2 and serves it by discharging the amended Done When that names the single permitted existing-assertion change, confirming by diff review that no other assertion was relaxed. |
| task | task-5 | story-2 | covered | Implements story-2's happy path and its deletion and mixed-set negative paths, and asserts the seal file is byte-identical after a refused rotation. |
| task | task-6 | story-4 | covered | Implements story-4's happy paths — wrapper-side resolution reusing the existing merge-base probe — and its no-`execa` negative path. |
| task | task-7 | story-3 | covered | Implements story-3's no-merge-base and failed-diff negative paths and asserts neither can yield a permitted verdict. |
| task | task-8 | story-4 | covered | Implements story-4's zero-probe negative paths for the ancestor short-circuit and for non-diverging protected paths. |
| task | task-9 | story-5 | covered | Implements story-5's three happy paths, one per environmental refusal class, and asserts no `rebaselines[]` entry is appended. |
| task | task-10 | story-5 | covered | Implements story-5's negative paths — the two escalating refusal classes and the failing-inspection precedence. |
| task | task-11 | story-6 | covered | Implements story-6's refusal-evidence happy path and its indeterminate-provenance negative path. |
| task | task-12 | story-6 | covered | Implements story-6's rebaseline base-ahead path list. |
| task | task-13 | story-6 | covered | Implements story-6's daemon rendering happy path. |
| task | task-14 | story-6 | covered | Implements story-6's throwing-observer and additive-fields negative paths and its no-new-variant, no-new-ledger, no-sidecar assertion. |
| task | task-15 | story-7 | covered | Implements story-7's happy paths and all three negative paths, including the empty-`paths` and failed-diff cases. |
| task | task-16 | story-8 | covered | Implements story-8's happy path against a real git fixture with no hand-edited JSON and no reseal invocation. |
| task | task-17 | story-8 | covered | Implements story-8's three negative variants. |

## Requirement-axis traceability (technical track)

There is no PRD, so the enumerated-requirement role is filled by the approved decision records. Each
decision item and each architecture-review condition maps to at least one story above; none is
uncovered.

`adr-2026-08-09-seal-rotation-authorship-predicate` — item 1 (authorship predicate and base-ahead
exclusion) is carried by story-1, story-2, and story-8; item 2 (fail closed on indeterminate) by
story-3; item 3 (narrow non-escalation) by story-5; item 4 (refusal telemetry carries classifying
evidence) by story-6.

`adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator` — items 1 through 4 (pure evaluator
takes authorship as data, three-valued and not collapsed at the boundary, one definition of
provenance reusing the existing merge-base probe, resolution scoped to diverging paths) are all
carried by story-4, whose acceptance criteria assert each of the four properties separately.

`architecture-review-2026-08-09-manual-rebase-strands-protected-artifact-seal` — COND-1 (pure
evaluator seam) is carried by story-4; COND-2 (fail closed on indeterminate probe) by story-3, whose
three negative paths cover the no-merge-base, failed-diff, and unresolvable-base-ref branches
individually as the condition requires; COND-3 (escalation boundary unweakened) by story-2 and
story-5; COND-4 (`.docs/decisions` in the rotation audit paths) by story-7; COND-6 (reproduce the
reported sequence end to end) by story-8, with story-1 and story-6 covering its component
assertions.

COND-5 (declare the #1281 sequencing) is deliberately carried by no story. It is a DECIDE-time
recording obligation, not shippable behavior, and it is discharged in
`.docs/conflicts/manual-rebase-strands-protected-artifact-seal.md`, which states the ordering
decision — #1281 lands first, this feature rebases onto it — with its rationale. Authoring a story
for it would have created a task with no production behavior to implement.

## Consistency pass

Every covered row was re-read for contradiction, and cross-layer pairs sharing a subject were
checked in both directions. No `fail` row was found.

The pair worth recording is outcome-1 against task-9. Outcome-1 asks that the seal end up valid
against the resulting HEAD; task-9 deliberately leaves the seal unrotated when the base tip cannot be
resolved. Checked both directions: fully satisfying task-9 does not prevent outcome-1, because
verification passes in that state and no operator action is required — the seal simply stays where it
is until the base ref resolves. Fully satisfying outcome-1 does not require rotating on an
unresolvable base tip, which would mean rebaselining against an authority that cannot be read. The
two are compatible, and the case is explicitly covered by story-8's third negative path rather than
left implicit.

The outcome-2 / outcome-3 pair was also checked as the most likely oscillation candidate, since one
widens what is permitted and the other insists nothing is weakened. They are disjoint by
construction rather than by balance: outcome-2 concerns paths the feature provably did not touch
since the merge-base, outcome-3 concerns paths it did. No input can satisfy both predicates, so
satisfying either leaves the other intact.
