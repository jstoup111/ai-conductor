# Protected-artifact seal: report self-amendment instead of tolerating it silently

Status: Accepted

Refs: jstoup111/ai-conductor#1047
Decision: `.docs/decisions/adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md`

## Context

`inspectSeal` currently tolerates ANY content change to a protected DECIDE artifact whose
filename stem names the current feature, unconditionally and silently. That was a temporary
operator-directed stopgap to unblock a halt/rekick loop. It cannot tell a legitimate
self-amendment (the build agent updating its own architecture doc to reflect in-scope work a
`build_review` kickback flagged) from a build agent quietly rewriting its own approved doc so
out-of-scope work looks pre-approved.

The chosen durable mechanism keeps the build unblocked but removes the silence: the seal reports
what it tolerated, the engine surfaces it, and `build_review` — which already grades scope
against the plan, and already receives the amended file in its diff — is told that DECIDE
artifacts are approval-bearing.

## Story 1 — The seal reports the self-amendments it tolerated

As the protected-artifact seal, when I tolerate an own-feature content change, I must report
that change on my success verdict rather than silently continuing, so the engine and downstream
review have something concrete to act on.

### Happy Path

- **Given** a sealed workspace whose `.docs/architecture/<feature>.md` content has changed and
  whose stem names the current `featureDesc`,
- **When** `verifyProtectedArtifactSeal` runs,
- **Then** the verdict is still `{ ok: true }` (the build is NOT halted),
- **And** the verdict carries a `selfAmendments` list containing one entry for that path,
  recording the path, the sealed fingerprint, and the current fingerprint.

### Negative Paths

- **Given** a sealed workspace with no protected-artifact drift at all,
- **When** `verifyProtectedArtifactSeal` runs,
- **Then** the verdict is `{ ok: true }` with an **empty** `selfAmendments` list — a clean
  workspace never reports a phantom amendment.

- **Given** a changed protected artifact whose stem names a DIFFERENT feature, and which is not
  byte-identical to the base branch tip,
- **When** `verifyProtectedArtifactSeal` runs,
- **Then** the verdict is `{ ok: false, reason: 'Protected artifact changed: <path>' }` exactly
  as before — reporting must not become a way to downgrade a real tamper halt.

- **Given** a protected artifact that was ADDED or DELETED, even one naming the current feature,
- **When** `verifyProtectedArtifactSeal` runs,
- **Then** the verdict is `{ ok: false }` with the existing added/deleted reason — this story
  changes the CHANGED branch only.

- **Given** drift that is byte-identical to the base branch tip (#976 base inheritance),
- **When** `verifyProtectedArtifactSeal` runs with `baseBranch` supplied,
- **Then** it is tolerated as before and is **not** reported as a self-amendment — it is
  inherited content the base branch vouches for, not an amendment this feature authored.

## Story 2 — The engine surfaces a tolerated self-amendment in the log

As an operator reading the daemon log, when a feature amends its own approved DECIDE artifact
mid-build, I must see that it happened and which file it was, so a silent rewrite is impossible.

### Happy Path

- **Given** a BUILD or SHIP step whose seal verification returns `ok: true` with a non-empty
  `selfAmendments` list,
- **When** the conductor processes that verdict,
- **Then** it emits one visible non-fatal advisory naming each amended path,
- **And** the step proceeds normally — the advisory never sets `protectedArtifactIssue` and never
  blocks dispatch.

### Negative Paths

- **Given** a seal verification returning `ok: true` with an empty `selfAmendments` list,
- **When** the conductor processes that verdict,
- **Then** no advisory is emitted — the common clean path stays quiet.

- **Given** a seal verification returning `ok: false`,
- **When** the conductor processes that verdict,
- **Then** the existing halt behavior is unchanged (`protectedArtifactIssue` is set from
  `reason`) and the advisory path is irrelevant.

## Story 3 — build_review treats an unjustified DECIDE-artifact edit as a Scope failure

As the `build_review` grader, when the diff I am given modifies an approved DECIDE artifact, I
must judge whether the approved plan justifies that edit, so a self-amendment that launders
out-of-scope work fails the gate.

### Happy Path

- **Given** a grader prompt assembled by `buildGraderPrompt`,
- **When** the prompt is rendered,
- **Then** its Scope rubric item carries an explicit rule that a diff modifying a file under
  `.docs/architecture/`, `.docs/plans/`, `.docs/specs/`, or `.docs/stories/` is an edit to an
  already-approved artifact, and must be justified by the approved plan or scored as a Scope
  failure.

### Negative Paths

- **Given** the same prompt,
- **When** it is rendered,
- **Then** it still contains the four existing rubric items and the all-or-FAIL rule verbatim —
  the new rule is additive and must not displace or reword the existing rubric.

- **Given** a self-amendment that was never committed and therefore does not appear in the
  grader's `merge-base..HEAD` diff,
- **When** `build_review` runs,
- **Then** the grader cannot be expected to flag it, and the visible record of the amendment
  remains Story 2's engine advisory — this is the accepted residual risk recorded in the ADR, not
  a defect of this story.
