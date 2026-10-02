**Status:** Accepted

# Stories: Fence SHIP validator verdict artifacts from BUILD writers (#2874)

Track: technical

Tier: S

Approved by the operator on 2026-10-02. Scope is skill text only: the `pipeline`, `tdd`, and `remediate` skills declare SHIP validator verdict artifacts read-only for BUILD and remediation sessions. The verdict artifacts are `.pipeline/prd-audit.md`, `.pipeline/architecture-review-as-built.md`, `.pipeline/architecture-review-as-built.json`, and their code-stamp sidecars `.pipeline/prd-audit-code-stamp.json` and `.pipeline/architecture-review-as-built-code-stamp.json`. Engine, hook, provider-sandbox, and provenance machinery are out of scope.

## Story 1: BUILD sessions never author a SHIP verdict

### Acceptance Criteria

#### Happy Path

- Given a BUILD remediation retry whose prompt cites a SHIP verdict artifact as evidence, when the BUILD orchestrator follows the `pipeline` skill, then the skill tells it to read that artifact for the finding and never write, delete, rename, or recreate any of the five named verdict artifacts.
- Given an implementer dispatched during BUILD, when it follows the `tdd` skill, then the skill names the same five verdict artifacts as read-only evidence it must not write, delete, rename, or recreate.

#### Negative Paths

- Given a BUILD session that believes it has fixed a SHIP finding, when it closes the remediation task, then the `pipeline` skill states that only the validator's own next dispatch produces a new verdict and that the session records its proof through `conduct task done` evidence instead of editing the verdict.
- Given the read-only rule, when a BUILD session needs the finding's detail, then the `pipeline` and `tdd` skills still direct it to read `.pipeline/remediation.json` and the cited verdict artifact, so reading is not forbidden.

### Done When

- [ ] The pipeline skill-contract test asserts the `pipeline` and `tdd` skills each name all five verdict artifact paths together with a never-write, never-delete, never-recreate rule.
- [ ] The pipeline skill-contract test asserts the `pipeline` skill states that only the validator's own dispatch produces a verdict and that reading the cited artifacts remains allowed.

## Story 2: Remediation reads verdict inputs without rewriting them

### Acceptance Criteria

#### Happy Path

- Given the `remediate` skill loads gap-based inputs from `.pipeline/prd-audit.md` or `.pipeline/architecture-review-as-built.md`, when it lists those inputs, then it marks the SHIP verdict artifacts as read-only evidence and names `.pipeline/remediation.json` as its only write in that mode.

#### Negative Paths

- Given a remediation planner that concludes a SHIP finding is already resolved, when it records that conclusion, then the `remediate` skill directs it to say so in `.pipeline/remediation.json` and forbids editing, deleting, or recreating the verdict artifact to change its verdict.

### Done When

- [ ] The remediate skill-contract test asserts the gap-based input section marks the SHIP verdict artifacts read-only and forbids editing, deleting, or recreating them.
