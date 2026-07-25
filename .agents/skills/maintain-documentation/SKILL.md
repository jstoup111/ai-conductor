---
name: maintain-documentation
description: Review and maintain this repository's human-facing documentation. Use when this repository invokes its maintain-documentation custom step or explicitly requests documentation maintenance.
---

# Maintain Documentation

Maintain this repository's human-facing documentation when invoked.

## Invocation modes

### pre-finish

- Select: Run as the configured gate after implementation and before `finish`.
- Input: Inspect the current implementation change and repository evidence.
- Output: Produce a documentation impact verdict and complete required human-facing documentation updates.
- Commit: Commit documentation and eligible changelog changes before PASS. Create no commit for an evidence-backed no-op.
- Changelog: Evaluate the current implementation under the changelog policy. Apply eligible changelog changes in this mode.
- PASS: Use when documentation is aligned or remediated and every required commit is complete.
- BLOCKED: Use when required work cannot be completed or verified.

### documentation-only

- Select: Run for an explicit documentation change outside an implementation verdict.
- Input: Inspect the requested scope and supporting repository evidence.
- Output: Complete the requested documentation result. Produce no implementation verdict.
- Commit: Commit completed documentation changes. Create no commit when no changes are required.
- Changelog: Do not change `CHANGELOG.md`.
- PASS: Use when the requested result is complete and verified.
- BLOCKED: Use when the requested result cannot be completed or verified.

### manual-audit

- Select: Run for an explicit operator-requested documentation audit.
- Input: Inspect the requested audit scope and supporting repository evidence.
- Output: Record findings and complete safe documentation remediation.
- Commit: Commit completed remediation changes. Create no commit for findings-only or no-op results.
- Changelog: Change `CHANGELOG.md` only when the requested audit scope includes it.
- PASS: Use when the audit is complete and all safe required remediation is complete.
- BLOCKED: Use when the audit cannot be completed or required remediation remains unresolved.

## Evidence lifecycle

1. Remove `.pipeline/maintain-documentation-pass` before performing mode work.
2. Overwrite `.pipeline/maintain-documentation-review.md` at the start of every invocation. Never append to a prior review.
3. Complete every required commit before writing `.pipeline/maintain-documentation-pass`.
4. Overwrite the review with the final mode, scope, inputs, documentation changes, actual commit result, changelog result, evidence, verdict, and blockers.
5. Write `.pipeline/maintain-documentation-pass` only after a PASS verdict.
6. For BLOCKED, keep the pass marker absent and record the blockers in the review.

## Impact decisions

1. Inspect the current implementation for changes to these documented surfaces: installation, CLI, workflow, configuration, artifact, state, behavior, recovery, extension, code organization, and architecture.
2. Apply this authority rule: implemented code, tests, generated help, schemas, and observed behavior outrank `.docs/`; treat `.docs/` as context only.
3. When no documented surface changed, record an evidence-backed no-op and create no documentation commit.
4. Remove obsolete human-facing documentation only when removal leaves no dangling canonical link; otherwise return BLOCKED.
5. When authoritative evidence contains an unresolved contradiction, return BLOCKED and keep the pass marker absent. Do not document disputed intent as fact.

## Mutation boundaries

- `.docs/` is read-only. Never create, edit, move, rename, or delete any `.docs/` file. This rule has no exception.
- Inline source comments: Flag contradictions only. Do not create, edit, move, rename, or delete them.
- JSDoc: Flag contradictions only. Do not create, edit, move, rename, or delete it.
- Docstrings: Flag contradictions only. Do not create, edit, move, rename, or delete them.
