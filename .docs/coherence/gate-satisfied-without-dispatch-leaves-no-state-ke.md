# Coherence: FINISH implementation-evidence observation and its diagnostic (#1587)

**Date:** 2026-09-14
**Verdict:** PASS with one waived outcome
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD; the stories file carries the
requirement layer directly).
**Outcome source:** the four Desired-outcome bullets of jstoup111/ai-conductor#1587, staged into
`.pipeline/intake-outcomes.md` by hand because `compose claim` returned a recovered stale claim
whose placeholder body carried no bullets.

Inputs: the accepted stories, the clean conflict report, the seven-task plan, and the approved
architecture review, all under this feature's stem. No ADR was created or amended by this change
set, so the `adr` row class is omitted.

Semantic confidence: 93%, inferred. The counterpart existence and quotation grounding are
mechanically checkable; the judgement that each cited task actually satisfies its criterion rests
on reading the plan's Done-when checks against the story text, not on an implementation result.
One load-bearing assumption is recorded and resolved in the architecture review — that
adr-2026-08-01 D1's "not trusted without git or GitHub evidence" clause governs publication
markers rather than implementation evidence, which has no git or GitHub counterpart.

## Outcome dispositions

The outcome rows below carry the staged bullet verbatim and nothing else, because the engine
compares that cell against `.pipeline/intake-outcomes.md`. The reasoning for each disposition is
recorded here instead.

**outcome-1 — covered by story-1.** Its premise, that the resolution goes unrecorded, is the
filer's hypothesis and is false: every resolution already writes `.pipeline/gates/<step>.json`,
through `computeAndWriteVerdict` when the step ran and `recordSkipVerdict` when it was skipped.
Nothing is silently unrecorded. What was missing is that FINISH read a different record. Story 1
makes the gate verdict the record FINISH consults, so a gate the loop resolved can no longer be
invisible to the publication preflight. The alternative reading — copy the verdict into step state
— is refused by three approved decisions: adr-2026-07-11-verdict-aware-resume-entry's rejected
Option C, adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch D3, and
adr-2026-08-03-build-repair-member-reuse-validity.

**outcome-2 — covered by story-1.** Story 1 requires the observation to reach its answer through
the selector's exported `gateSatisfied`, the same predicate the resume clamp and the gate-driven
tail already call. One authority by construction, which is what
adr-2026-07-11-verdict-aware-resume-entry D5 requires: "No new satisfaction predicate is
introduced."

**outcome-3 — gap, waived.** The non-convergence detection and its halt are refused by
adr-2026-08-16-restore-the-current-head-publication-fence D5 ("Bounding is inherited, not invented.
No new counter, allowance, or cap is introduced") and fall outside
adr-2026-08-12-cumulative-build-review-convergence-bound D6's declared `build_review`-only scope.
The cycle they guard is also unevidenced: across 170 features, all five observed
`implementation_evidence_invalid` blocks self-recovered within one lap. The outcome's second half —
halting "with the specific unsatisfied predicate named" — IS delivered, by story-2. See
`.docs/coherence-waivers/gate-satisfied-without-dispatch-leaves-no-state-ke.md`.

**outcome-4 — covered by story-1.** Story 1's five negative criteria keep the refusal direction
intact: a false verdict, an absent verdict with no step key, a `stale` step, an unreadable verdict
directory, and a malformed verdict file each still block FINISH.

## Coherence table

| Row class | Cited id(s) / exact criterion | Counterpart id(s) | Verdict | Notes / Done when quote | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | "A gate the loop deems satisfied leaves the same durable status a dispatched-and-completed step leaves; "satisfied silently" is not representable." |
| outcome | outcome-2 | story-1 | covered | "FINISH's implementation-evidence predicate and the loop's gate-completion predicate cannot disagree about the same step: one source of truth, or the stricter one is used by both." |
| outcome | outcome-4 | story-1 | covered | "Negative path: genuinely missing or stale review evidence still blocks FINISH." |
| outcome | outcome-3 |  | gap | "A finish→build kickback whose remedy changes nothing observable twice in a row is detected as non-converging and halts with the specific unsatisfied predicate named, instead of cycling." |
| story | story-1 | task-1, task-2, task-3, task-4 | covered | Verdict-fed observation plus its unsatisfied/unrecorded, staled-step, and unreadable/malformed-store negative paths. |
| story | story-2 | task-5, task-6, task-7 | covered | Typed unsatisfied-member field, its rendering into the kickback evidence and build retry hint, and the two cases where no member may be named. |
| task | task-1 | story-1 | covered | Redirects the observation to `gateSatisfied` with verdicts; covers the three happy-path criteria and asserts the selector export is the one called. |
| task | task-2 | story-1 | covered | A false verdict and an absent verdict-with-absent-key both refuse, proving the verdict outranks the state key. |
| task | task-3 | story-1 | covered | A `stale` step refuses despite a satisfied verdict, via `gateSatisfied`'s own leading branch rather than a local comparison. |
| task | task-4 | story-1 | covered | Absent verdict directory and malformed verdict file degrade to step state without raising and never read as satisfied. |
| task | task-5 | story-2 | covered | Widens the observation result and the `implementation_evidence_invalid` condition and `implementation_invalid` result to carry the unsatisfied members. |
| task | task-6 | story-2 | covered | The single integration-owning task: the typed field reaches the conductor's `retry_build` branch and is rendered into the kickback evidence and the build retry hint. |
| task | task-7 | story-2 | covered | Indeterminate evidence and unrelated publication conditions name no member and keep their existing guidance. |
| criterion | Story 1 happy: Given `build_review` and `test_suite` each carry a satisfied gate verdict and neither has a step-status key, when FINISH observes implementation evidence, then the evidence reads valid and publication proceeds past the implementation-evidence preflight. | task-1 | covered | "asserted by the no-state-key test" | diff-local |
| criterion | Story 1 happy: Given `build_review` and `test_suite` each carry a satisfied gate verdict and each also has a `done` step status, when FINISH observes implementation evidence, then the evidence reads valid, as it does today. | task-1 | covered | "preserving today's behavior on the ordinary path" | diff-local |
| criterion | Story 1 happy: Given a gate was resolved by a skip verdict rather than a run, when FINISH observes implementation evidence, then that gate counts as satisfied and does not by itself make the evidence invalid. | task-1 | covered | "asserted by the skip-verdict test" | diff-local |
| criterion | Story 1 negative: Given `build_review` carries a gate verdict whose satisfied flag is false, when FINISH observes implementation evidence, then the evidence reads invalid and publication is blocked at the implementation-evidence preflight. | task-2 | covered | "proving the verdict outranks the state key" | diff-local |
| criterion | Story 1 negative: Given `test_suite` has no gate verdict on disk and no step-status key, when FINISH observes implementation evidence, then the evidence reads invalid rather than defaulting to satisfied. | task-2 | covered | "reports evidence missing rather than defaulting to satisfied" | diff-local |
| criterion | Story 1 negative: Given `build_review` carries a satisfied gate verdict but its step status is `stale`, when FINISH observes implementation evidence, then the evidence reads invalid, because a staled step must re-run regardless of an older verdict. | task-3 | covered | "asserted by the stale-step test" | diff-local |
| criterion | Story 1 negative: Given the gate-verdict directory cannot be read at all, when FINISH observes implementation evidence, then the observation falls back to step status alone and does not throw, and a feature whose steps are not `done` still reads invalid. | task-4 | covered | "completes the observation without raising, and its result is decided by step status alone" | diff-local |
| criterion | Story 1 negative: Given a gate-verdict file exists but its content is malformed, when FINISH observes implementation evidence, then that gate is treated as carrying no verdict rather than as satisfied. | task-4 | covered | "proving malformed content never reads as satisfied" | diff-local |
| criterion | Story 2 happy: Given `build_review` is the only unsatisfied member when FINISH observes implementation evidence, when publication is blocked, then the refusal carries `build_review` as the named unsatisfied step in a typed field. | task-5 | covered | "asserted by the single-member test" | diff-local |
| criterion | Story 2 happy: Given `test_suite` is the only unsatisfied member, when publication is blocked, then the refusal carries `test_suite` as the named unsatisfied step in a typed field. | task-5 | covered | "exposes a typed field whose value is exactly that member" | diff-local |
| criterion | Story 2 happy: Given both members are unsatisfied, when publication is blocked, then the refusal names both, in the order the members are evaluated. | task-5 | covered | "exposes both, in the order the members are evaluated" | diff-local |
| criterion | Story 2 happy: Given a blocked publication is routed back to build, when the kickback evidence and the build retry hint are composed, then each names the unsatisfied step or steps carried on the typed field. | task-6 | covered | "so the operator-visible remedy and the recorded evidence agree" | diff-local |
| criterion | Story 2 negative: Given a consumer needs to know which step was unsatisfied, when it obtains that step, then it reads the typed field, and a test that changes the refusal's human-readable message leaves every consumer's behavior unchanged. | task-6 | covered | "proving no consumer parses the message" | diff-local |
| criterion | Story 2 negative: Given implementation evidence is indeterminate rather than invalid, when publication is blocked, then the refusal carries no named unsatisfied step, because no step was established as unsatisfied. | task-7 | covered | "because no member was established as unsatisfied" | diff-local |
| criterion | Story 2 negative: Given a publication is blocked for a condition other than invalid implementation evidence, when the refusal is rendered, then it carries no named unsatisfied step and the existing guidance for that condition is unchanged. | task-7 | covered | "asserted against that condition's existing message and nextAction values" | diff-local |
