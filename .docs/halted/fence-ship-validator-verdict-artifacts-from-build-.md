# Halt record

Status: halted
Slug: fence-ship-validator-verdict-artifacts-from-build-
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-fence-ship-validator-verdict-artifacts-from-build-
Head SHA: 513c64fa2694452d7682620ca6e1d751d879c310
Halted at: 2026-10-02T20:08:55.547Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 happy: Given a BUILD remediation retry whose prompt cites a SHIP verdict artifact as evidence, when the BUILD orchestrator follows the `pipeline` skill, then the skill tells it to read that artifact for the finding and never write, delete, rename, or recreate any of the five named verdict artifacts.
Task ids: 1
Done when checks: `test/test_skill_pipeline_contract.sh` exits 0 and its new contract asserts all five verdict artifact paths appear in both `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md`. | The new contract asserts both skills state the verdict artifacts are never written, deleted, or recreated by a BUILD session. | The new contract asserts the pipeline skill states only the validator's own dispatch produces a new verdict and that proof is recorded through `conduct task done`. | The new contract asserts the pipeline skill states reading `.pipeline/remediation.json` and the cited verdict artifact remains allowed. | The pipeline skill's implementer dispatch requirements include a bullet requiring every dispatch prompt to carry the verdict read-only rule.
Missing assertion: The checks do not require that verdict artifacts are never renamed.

Criterion: Story 1 happy: Given an implementer dispatched during BUILD, when it follows the `tdd` skill, then the skill names the same five verdict artifacts as read-only evidence it must not write, delete, rename, or recreate.
Task ids: 1
Done when checks: `test/test_skill_pipeline_contract.sh` exits 0 and its new contract asserts all five verdict artifact paths appear in both `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md`. | The new contract asserts both skills state the verdict artifacts are never written, deleted, or recreated by a BUILD session. | The new contract asserts the pipeline skill states only the validator's own dispatch produces a new verdict and that proof is recorded through `conduct task done`. | The new contract asserts the pipeline skill states reading `.pipeline/remediation.json` and the cited verdict artifact remains allowed. | The pipeline skill's implementer dispatch requirements include a bullet requiring every dispatch prompt to carry the verdict read-only rule.
Missing assertion: The checks do not require that verdict artifacts are never renamed.

Criterion: Story 1 negative: Given the read-only rule, when a BUILD session needs the finding's detail, then the `pipeline` and `tdd` skills still direct it to read `.pipeline/remediation.json` and the cited verdict artifact, so reading is not forbidden.
Task ids: 1
Done when checks: `test/test_skill_pipeline_contract.sh` exits 0 and its new contract asserts all five verdict artifact paths appear in both `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md`. | The new contract asserts both skills state the verdict artifacts are never written, deleted, or recreated by a BUILD session. | The new contract asserts the pipeline skill states only the validator's own dispatch produces a new verdict and that proof is recorded through `conduct task done`. | The new contract asserts the pipeline skill states reading `.pipeline/remediation.json` and the cited verdict artifact remains allowed. | The pipeline skill's implementer dispatch requirements include a bullet requiring every dispatch prompt to carry the verdict read-only rule.
Missing assertion: The checks require allowed reading only in the pipeline skill, not in both pipeline and tdd skills.
```
