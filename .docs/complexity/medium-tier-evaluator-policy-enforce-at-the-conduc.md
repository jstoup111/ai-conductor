# Complexity: build_review implementation-quality rubric (#475)

Tier: M

## Rationale

Adds a third built-in `build_review` rubric, enabled by default, judging code quality and domain
integrity (acceptance-criteria compliance stays with `prd_audit`). It follows the shipped `security` rubric pattern
(#2568: rubric catalog entry, `skills/build-review-<name>/SKILL.md`, domain parsing, config default,
vocabulary integrity check) inside one subsystem with no new architecture, so it is not Large.

It is not Small: it turns on a new blocking LLM judgment gate for every consumer build by default
(cost, latency, and kickback-cycling risk), the rubric's judgment contract must be designed, and its
diff placement must be reconciled with the landed child-by-child build-loop spec (#3050), which runs
`security` at the leaf over the whole-feature snapshot and `testQuality` per child.

## Signals

| Signal | Assessment |
|---|---|
| Established pattern | Yes — mirrors the `security` rubric addition |
| Subsystems touched | One (`build_review`) plus config defaults and shipped skill catalog |
| Default behavior change | Yes — default-on blocking gate for all consumers |
| Cross-spec interaction | Yes — rubric projection placement under #3050 |
| Follow-on work | Retiring `/pipeline` batch evaluators is out of scope (#3056, blocked on #475) |
