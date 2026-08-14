**Status:** Accepted

# Stories: Operator reseal reaches build_review's Scope rubric as judged evidence

**Track:** Technical (no PRD — acceptance criteria live here)
**Tier:** M
**Source:** intake `jstoup111/ai-conductor#1502`
**Design:** `.docs/architecture/an-operator-s-protected-artifact-reseal-is-invisib.md`,
`.docs/decisions/architecture-review-2026-08-12-an-operator-s-protected-artifact-reseal-is-invisib.md`

> **Test-boundary note, load-bearing for Stories 4 and 5.** This repository's policy is that
> third-party calls are smoke-only: the default suite uses faithful fakes at every LLM boundary.
> The grader's *judgement* therefore cannot be asserted in the default suite. Every scenario below
> is written against what is deterministically observable — the assembled prompt string and the
> inputs that produce it — which is where the defect in #1502 actually lives (the evidence never
> reaches the prompt at all). Scenarios that genuinely require a real grader verdict are marked
> **[smoke]** and belong to the opt-in smoke suite, never the default one.

## Story 1: Operator reseals are read from the seal and machinery rotations are not

**Requirement:** #1502 desired outcomes 1, 4

As the build_review input assembler, I want to read only the operator-authorized rebaselines from
the protected-artifact seal, so that an operator's authorization becomes available to the grader
while machinery rotations never masquerade as authorization.

### Acceptance Criteria

#### Happy Path
- Given a seal whose `rebaselines` contains one entry with `trigger` `operator-reseal`, `paths`
  `[".docs/stories/x.md"]`, a non-empty `reason`, and `fromCommit`/`toCommit`, when the reader runs,
  then it returns exactly one record carrying that path, that verbatim reason, and both commit shas.
- Given a seal with three `operator-reseal` entries appended over time, when the reader runs, then
  it returns all three in the order they appear in `rebaselines`.
- Given a seal with an `operator-reseal` entry listing two paths, when the reader runs, then both
  paths are present on the returned record.

#### Negative Paths
- Given a seal whose only rebaseline has `trigger` `proactive-rebase`, when the reader runs, then it
  returns an empty list — a rebase rotation is never surfaced as authorization.
- Given a seal whose only rebaseline has `trigger` `defensive-history-rewrite`, when the reader
  runs, then it returns an empty list.
- Given a seal mixing one `operator-reseal` entry and two machinery entries, when the reader runs,
  then exactly the one `operator-reseal` record is returned and neither machinery entry appears.
- Given a seal whose rebaseline carries an unrecognized future `trigger` value, when the reader
  runs, then it is excluded — the filter matches the literal `operator-reseal`, never a fallback or
  catch-all.
- Given an `operator-reseal` entry whose `reason` is absent (the field is optional on the persisted
  type), when the reader runs, then the record is still returned with an empty rationale rather than
  being dropped or throwing.

### Done When
- [ ] A reader over the seal's `rebaselines` exists and is exported from the engine.
- [ ] Given a fixture seal containing all three known `trigger` values, the reader returns only the
      `operator-reseal` entries — asserted by count and by path.
- [ ] The returned record exposes path(s), verbatim `reason`, `fromCommit`, and `toCommit`.
- [ ] A test asserts that adding a new unknown trigger value to a fixture does not cause it to be
      returned.

## Story 2: A missing or unusable seal degrades to an empty channel and never fails the step

**Requirement:** #1502 desired outcome 5 (the feature must reach BUILD, not acquire a new failure mode)

As a feature being graded, I want build_review's input assembly to survive any seal state, so that
adding this evidence channel can never convert a Scope kickback into a hard step failure.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree with a well-formed version-2 seal, when input assembly runs, then the
  reseal channel is populated and assembly completes normally.

#### Negative Paths
- Given a worktree with no `.pipeline/protected-artifact-seal.json` at all (a feature that never
  entered BUILD), when input assembly runs, then it completes successfully with an empty reseal
  channel and does not throw.
- Given a seal file containing malformed JSON, when input assembly runs, then it completes
  successfully with an empty reseal channel and does not throw.
- Given a version-1 seal (which normalizes `rebaselines` to `[]` at parse), when input assembly
  runs, then the reseal channel is empty and assembly completes normally.
- Given a seal file that is well-formed JSON but whose `rebaselines` is absent or not an array, when
  input assembly runs, then the reseal channel is empty and assembly completes normally.
- Given a seal file that exists but cannot be read (permission error), when input assembly runs,
  then the reseal channel is empty and assembly completes normally.
- Given a plan path that does not resolve to a feature root — the same alternate branch on which
  `repairContext` already resolves to `[]` — when input assembly runs, then the reseal channel is
  likewise empty and assembly completes normally rather than probing a nonexistent worktree.

### Done When
- [ ] `assembleBuildReviewInputs` returns successfully for each of: absent seal, malformed JSON,
      version-1 seal, non-array `rebaselines`, unreadable file — each asserted to yield an empty
      reseal channel.
- [ ] No test in the suite can produce a thrown error from input assembly attributable to the seal
      read.
- [ ] The non-feature-root plan-path branch is covered by its own assertion, not inferred from the
      feature-root case.

## Story 3: The grader prompt carries an operator-reseal evidence section

**Requirement:** #1502 desired outcomes 1, 3

As the build_review grader, I want the operator's authorization and its stated rationale rendered in
my prompt, so that I can judge an amendment I would otherwise have no basis to accept.

### Acceptance Criteria

#### Happy Path
- Given inputs carrying one operator reseal, when the grader prompt is assembled, then the prompt
  contains a distinctly-headed operator-reseal evidence section.
- Given that same input, when the prompt is assembled, then the section names the resealed path, the
  operator's rationale **verbatim**, and the `fromCommit`/`toCommit` range.
- Given inputs carrying two reseals covering different paths, when the prompt is assembled, then
  both appear as separate entries.
- Given inputs carrying no reseals, when the prompt is assembled, then the section renders the
  `(none)` empty marker, matching how the two existing evidence sections render when empty.

#### Negative Paths
- Given inputs carrying no reseals, when the prompt is assembled, then no path is described as
  authorized and the section body is exactly the empty marker — an empty channel never reads as a
  standing authorization.
- Given a reseal whose `reason` is empty, when the prompt is assembled, then the entry still renders
  its path and commit range with a visibly empty rationale, so the grader can fail it for lack of
  justification rather than silently not seeing it.
- Given a reseal whose `reason` contains text shaped like an instruction to the grader, when the
  prompt is assembled, then the rationale is rendered inside the section as an operator claim to be
  judged — the section's framing text states that the grader judges whether the rationale justifies
  the amendment, and never that the grader should comply with it.
- Given a reseal covering `.docs/stories/a.md`, when the prompt is assembled, then no other path
  appears in the section — the rendered set is exactly the resealed paths.
- Given inputs where the `operatorReseals` field is omitted entirely (an older caller), when the
  prompt is assembled, then the section renders `(none)` rather than `undefined` or a crash.

### Done When
- [ ] `buildGraderPrompt` output contains the operator-reseal section heading for populated inputs
      and the `(none)` marker for empty ones.
- [ ] A test asserts the rendered rationale string is byte-identical to the input `reason`.
- [ ] A test asserts the section's framing text instructs the grader to **judge** the rationale and
      states that unmatched work remains subject to every rubric item.
- [ ] A test asserts a path absent from the reseal set does not appear in the section.
- [ ] The field is optional on `BuildReviewInputs` and its omission is covered by a test.

## Story 4: The channel is evidence, never a blanket exemption

**Requirement:** #1502 desired outcomes 2, 3, 4

As an operator, I want a reseal to license exactly what I resealed and no more, so that the audit
value of the mechanism is preserved and a bad rationale is still catchable.

### Acceptance Criteria

#### Happy Path
- Given a reseal covering paths A and B, when the prompt is assembled, then only A and B appear in
  the evidence section and path C — edited post-BUILD in the same diff — is not labeled anywhere.
- Given a reseal, when the prompt is assembled, then the four rubric items other than Scope are
  unchanged in the prompt text.

#### Negative Paths
- Given a reseal covering A and B and a diff that also touches unrelated path C, when the prompt is
  assembled, then C receives no evidence entry and is presented to the grader exactly as it is
  today. **[smoke]** With a real grader, Scope fails on C.
- Given a reseal whose stated rationale does not justify the amendment, when the prompt is
  assembled, then the rationale is present and the framing directs the grader to judge it.
  **[smoke]** With a real grader, Scope can still fail.
- Given a reseal, when the prompt is assembled, then no text grants a standing exemption for
  `.docs/` paths — the existing Scope rubric sentence about approved DECIDE artifacts remains intact
  and unweakened.
- Given a reseal covering a path, when the prompt is assembled, then the Tautology and Completeness
  rubric instructions are not narrowed for that path — the evidence channel affects the basis for
  Scope judgement only.

### Done When
- [ ] A test asserts the Scope rubric sentence at `build-review-prompt.ts` is present and unmodified
      in the assembled prompt when reseals exist.
- [ ] A test asserts a diff path outside the resealed set produces no evidence entry.
- [ ] A test asserts the other four rubric items' instruction text is identical with and without
      reseals present.
- [ ] Smoke-only scenarios are tagged and excluded from the default suite per the repository's
      test-isolation policy.

## Story 5: Regression coverage runs in both directions

**Requirement:** #1502 desired outcome 6

As a maintainer, I want the defect's exact shape pinned in both directions, so that a future change
cannot silently restore the halt-forever behavior or over-correct into a blanket exemption.

### Acceptance Criteria

#### Happy Path
- Given a fixture reproducing #1502 — a diff amending a sealed DECIDE artifact, plus a seal carrying
  a matching `operator-reseal` rebaseline — when the prompt is assembled, then the amended path
  appears in the evidence section with its rationale.
- Given the identical diff and a seal with **no** `operator-reseal` rebaseline, when the prompt is
  assembled, then the evidence section renders `(none)` and the amended path appears nowhere as
  authorized.

#### Negative Paths
- Given the with-reseal and without-reseal fixtures, when both prompts are assembled, then they
  differ only in the evidence section — asserting the fix adds evidence rather than altering the
  rubric.
- Given a fixture whose reseal covers a path the diff does not touch, when the prompt is assembled,
  then the entry still renders (a reseal is not silently dropped for being unused) and no diff path
  is thereby labeled.
- Given the seal is rotated by a subsequent `proactive-rebase` after an `operator-reseal`, when the
  prompt is assembled, then the operator entry is still present — `rebaselines` is append-only and
  rotation preserves prior entries, so authorization survives a rebase.

### Done When
- [ ] Paired with-reseal / without-reseal fixtures exist and both assertions pass.
- [ ] A test asserts the two assembled prompts differ only within the evidence section.
- [ ] A test asserts an `operator-reseal` entry survives a simulated rotation that appends a
      machinery rebaseline.
- [ ] The #1502 reproduction is traceable from the test name or a cited comment to the issue.
