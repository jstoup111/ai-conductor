# ADR: Require full-replay intent validation for judgment-based rebase resolution

**Date:** 2026-08-01
**Status:** APPROVED
**Deciders:** James Stoup + harness architecture review
**Amends:** `adr-2026-06-29-rebase-conflict-resolution-dispatch`

## Context

The existing rebase resolver asks a model to resolve paused conflicts and accepts completion when deterministic guards prove only that the branch is current and commit subjects survived. The amended ADR explicitly accepts a semantically wrong but test-passing resolution as residual risk. Intake #1152 records a production incident where a replay invented unrelated CHANGELOG content in the wrong section and stripped the EOF newline; a later rebase detected it by chance.

Conflict resolution is semantic work. A correct resolution may require coordinated changes outside the directly conflicted hunk or file, so a mechanical resolver, file allowlist, hunk write restriction, or whole-patch equality rule would reject legitimate repairs. The safety boundary must therefore improve the judgment contract without constraining the valid edit surface.

## Options Considered

### Option A: Full-replay intent validation with conservative HALT

- **Pros:** Preserves semantic and cross-file resolution freedom; directly addresses invented or misplaced replay content; produces useful evidence when the model cannot prove a resolution correct.
- **Cons:** Remains judgment-based and cannot guarantee correctness mechanically; requires a stronger inspection protocol and adversarial contract tests.

### Option B: Mechanical file/hunk write restriction

- **Pros:** Deterministic, cheap, and easy to reject on violation.
- **Cons:** Incorrectly forbids legitimate coordinated edits outside the immediate conflict surface; rejected by the operator.

### Option C: Continue trusting downstream tests and human review

- **Pros:** No implementation change and maximum resolver flexibility.
- **Cons:** Repeats the demonstrated failure mode because release-note corruption can pass tests and later appear as unrelated scope drift.

## Decision

Adopt Option A. Before editing, the rebase skill must inspect the complete source commit being replayed, its parent context, the upstream changes that caused the conflict, and every affected file needed to understand intent. Before each `rebase --continue`, it must review the complete staged resolution—not only conflict markers—and confirm that every resulting change is attributable to the source commit's intent or a necessary adaptation to upstream.

Cross-file edits remain permitted when necessary. The resolver must explain and validate them against the replayed intent. If attribution is unclear, the source and upstream intentions conflict semantically, supporting context is missing, or the resolver cannot explain why every staged change belongs, it must not continue: it returns `resolved: false` with the replay commit, file/region, competing intentions, and missing decision named. After each continue, the skill rechecks the resulting replay commit before advancing to another conflict or reporting success.

The engine's existing deterministic branch-currency, active-rebase, and commit-preservation guards remain unchanged and complementary. This decision narrows the prior ADR's residual-risk acceptance: ambiguity is no longer accepted merely because downstream tests might pass.

> **Amended 2026-09-20 by #2607 (operator decision):** Every tier-2 sweep resolution ended in escalation, including one-hunk conflicts confined to a test file where the resolver named both intents exactly. The mandatory stop on semantically conflicting intent gains one narrow exception. Full-replay inspection, staged-change attribution, the post-continue recheck, and the stop on unclear attribution or missing context are unchanged, so the #1152 failure class stays covered. The Positive consequence "the same skill contract governs finish-time, re-kick, watched-PR, and manual invocations" now holds for everything except this exception.
>
> **D1** Test-only supersession judgement. When the mergeable sweep dispatches the resolver and every conflicted path in the paused replay is a test path under the engine's existing test-path convention, the resolver may decide which side's intent survives, including declaring the replayed commit superseded by upstream, instead of returning `resolved: false` for that reason alone. It returns a schema-bound verdict naming the choice, the rationale, and each declared-superseded commit. The engine, not the skill, establishes that the conflict is test-only and tells the resolver the exception is in force. Any conflicted non-test path, and every finish-time, re-kick, or manual invocation, keeps the stop stated above.

## Consequences

### Positive

- A resolver has an explicit full-replay correctness obligation instead of a conflict-marker-only task.
- Legitimate semantic fixes can still touch coordinated files.
- HALTs identify the replay commit and disputed intent, making operator recovery actionable.
- The same skill contract governs finish-time, re-kick, watched-PR, and manual invocations.

### Negative

- Safety still depends on model judgment; mechanical guards cannot prove semantic intent.
- Conservative resolution will HALT more often when evidence is incomplete.
- Prompt-contract tests can prove the instruction and wiring, not the quality of every future model decision; real-provider validation remains opt-in smoke only.

### Follow-up Actions

- [ ] Strengthen `skills/rebase/SKILL.md` with source-intent discovery, staged full-replay review, post-continue validation, and specific ambiguity evidence.
- [ ] Keep the provider-neutral semantic skill invocation and existing bounded runner/result contract.
- [ ] Add third-party-free contract and acceptance tests for the strengthened prompt, cross-file permission, and precise `resolved: false` propagation into HALT.
- [ ] Update daemon/rebase recovery documentation to describe the conservative ambiguity boundary and recovery evidence.
