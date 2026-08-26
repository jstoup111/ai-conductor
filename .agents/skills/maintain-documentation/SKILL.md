---
name: maintain-documentation
disable-model-invocation: true
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

## Audiences and destinations

Audience priority:

1. New users
2. Operators implementing features
3. Contributors modifying the codebase
4. Maintainers debugging internals

Select each destination by its purpose. Assign each fact to one canonical document.

- Quick start: Provide the shortest path to a working result.
- Guides: Provide task-oriented procedures.
- Reference and configuration: Define interfaces, options, and configuration facts.
- Explanation and deep dives: Explain concepts, behavior, and design.
- Runbooks: Define operational and recovery procedures.
- Contributor documentation and code organization: Explain development workflows and implementation structure.
- Changelog: Record release history.

Propose any new category for operator approval before using it. Treat current flat `docs/*.md` files as transitional until a separate migration.

## README ownership

Treat this README contract as a repository-local refinement of the global harness convention.

- Maintain README as one concise landing page.
- Allow value or marketing language only in one project-value section.
- Include requirements, installation, the shortest working quick start, a documentation map, and contribution and support links.
- In the shortest working quick start, highlight `conduct-ts --interactive`, daemon operation, and multiprovider use.
- For a reader-visible change, update the canonical affected document. Leave README unchanged unless the change affects its landing-page contract.
- Keep consumer projects without this custom step configuration unchanged; they continue to use the global harness convention.

## Writing rules

- Use concise, active, task-first instructions.
- Reject narrative.
- Allow marketing only in the README project-value section.
- Reject repetition.
- Reject conversational filler.
- Reject speculative commentary.
- Allow occasional dry humor only when clarity is unchanged.
- Link to the canonical source of truth. Repeat only the minimum quick-start commands needed to begin.

## Document rules

### Quick start

- Writing: Lead with the shortest working path to the first successful result.
- Troubleshooting: Place only common first-run blockers after the working steps; link to the canonical guide or runbook for more.

### Guides

- Writing: Use ordered task steps with prerequisites and observable outcomes.
- Troubleshooting: Place task-specific failures after the affected step or in a final troubleshooting section.

### Reference and configuration

- Writing: State exact interfaces, fields, defaults, constraints, and examples.
- Troubleshooting: Link errors and recovery procedures to the canonical guide or runbook.

### Explanation and deep dives

- Writing: Define the concept, constraints, mechanics, and consequences.
- Troubleshooting: Link procedural diagnosis and recovery to the canonical guide or runbook.

### Runbooks

- Writing: Organize operational response as symptom, diagnosis, recovery, and verification.
- Troubleshooting: Keep operational failure diagnosis and recovery in the runbook body.

### Contributor documentation and code organization

- Writing: Name development tasks, code paths, boundaries, dependencies, and extension points.
- Troubleshooting: Place build, test, and development failures beside the affected workflow or link to a runbook.

### Changelog

- Writing: Summarize the reader-visible release outcome.
- Troubleshooting: Link to the canonical guide or runbook; do not embed procedures.

## Verification

Verify only affected links, paths, commands, configuration, examples, artifacts, explanations, code organization, architecture, generated help, schema, and observed behavior, as applicable.

If a required claim cannot be verified, return BLOCKED. Never guess or weaken the claim.

## Changelog decisions

### Selection

- A notable reader-visible implementation change requires a release-note disposition in its PR metadata; the serialized release PR renders the changelog entry after merge.
- A non-notable implementation may PASS with an explicit no-note disposition.
- Spec-only, documentation-only, internal and non-notable, and no implementation change use the explicit no-note disposition.
- Do not author or finalize `CHANGELOG.md` on an implementation branch.

### Entry format

- Write the reader-facing release note as exactly one present-tense sentence led by the reader outcome.
- Record its category and semver impact in the implementation PR metadata; use the explicit no-note disposition when no entry is eligible.
- Do not edit `CHANGELOG.md`; the release PR renderer supplies implementation attribution. Preserve runnable migration blocks separate from the one-sentence release note.

### Blocking validation

For any condition below, return BLOCKED and keep the pass marker absent:

- missing required release-note disposition
- missing explicit no-note disposition for a non-notable implementation
- multiple sentences
- future tense
- internal mechanics first
