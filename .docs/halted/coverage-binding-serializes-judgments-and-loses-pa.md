# Halt record

Status: halted
Slug: coverage-binding-serializes-judgments-and-loses-pa
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-coverage-binding-serializes-judgments-and-loses-pa
Head SHA: b306611a0ef7a1c14ebeb3580403d189bf109ee0
Halted at: 2026-09-18T16:33:53.194Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Need DECIDE amendment: Task 9 requires a wording-only skill-contract assertion, but the required simplify gate removed it as no-signal; approve an amended behavioral coverage disposition or restore an authorized machine-consumed contract test.


stall:skill-contract-test (build: No DECIDE amendment is needed: restore the contract test in the authorized non-wording form this repo already uses. Task 9's Done when (.docs/plans/coverage-binding-serializes-judgments-and-loses-pa.md) requires the SKILL.md contract to be asserted by a skill-contract test, and src/conductor/test/engine/build-review-skill-contract.test.ts is the committed precedent for exactly that: it reads skills/build-review-test-quality/SKILL.md AND imports the engine parsers (build-review-domain.js) so the assertion binds published skill text to machine-consumed behavior rather than to wording alone. The deleted test (b306611a0, src/conductor/test/engine/coverage-binding-skill-contract.test.ts) was pure substring matching on prose, which is why the simplify gate correctly scored it no-signal. The restored test must instead feed the literal example payload from the `## Result contract` block of skills/coverage-binding/SKILL.md through parseJudgeBatchPayload (src/conductor/src/engine/coverage-binding-envelope.ts:120) with the digests that block carries, asserting ok:true, and assert that payloads violating the rules the skill states (a third verdict word, `missingAssertion` on `asserts`, a `does-not-assert` without one) are rejected with a reason naming the violation — so the test fails if the skill and the parser ever disagree. The skill deliverable itself is already correct on disk (skills/coverage-binding/SKILL.md states the digest-keyed `verdicts` array, one entry per supplied claim, the independence rule, and the closed verdict vocabulary), and the runner does consume it at dispatch via renderAuxiliarySkillInvocation('coverage-binding', ...) (src/conductor/src/engine/step-runners.ts:2745,2754), so the contract is behavioral, not documentation. Confidence: high (~92%) — grounded in the committed precedent test and the committed plan, not inference.) — remediation produced no dispatchable build work; the implicated task(s) are already evidence-complete — human needed
```
