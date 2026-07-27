# Implementation Plan: Protected-artifact seal reports self-amendment to build_review

Stem: 2026-07-27-protected-artifact-seal-self-amendment-1047
Track: technical
Tier: S
Refs: jstoup111/ai-conductor#1047
Decision: `.docs/decisions/adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md`

## Goal

Replace the temporary unconditional own-feature loosening in `inspectSeal` with a durable
mechanism that keeps the build unblocked but removes the silence: the seal **reports** each
tolerated self-amendment on its success verdict, the conductor **logs** it, and the
`build_review` grader is **told** that DECIDE artifacts are approval-bearing so an unjustified
self-amendment fails its existing Scope rubric item.

No new module, no new persisted state, no new gate, no new human checkpoint.

## Files

- `src/conductor/src/engine/protected-artifact-seal.ts` — report tolerated self-amendments on
  the `ok: true` verdict.
- `src/conductor/src/engine/conductor.ts` (~line 3764) — emit the advisory.
- `src/conductor/src/engine/build-review-prompt.ts` — add the Scope sub-rule.
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — extend the existing
  "own-feature self-amendment loosening" describe block.
- `src/conductor/test/engine/build-review-prompt.test.ts` — assert the new rule renders (create
  if absent).
- `CHANGELOG.md` — `## [Unreleased]` entry (harness repo gate; this is a notable reader-visible
  behavior change to a gate).

## Non-goals

- **No re-seal / re-approval workflow.** Explicitly rejected in the ADR — it reintroduces the
  blocking checkpoint that caused the halt/rekick loop this intake exists to end.
- **No halt-with-diff.** Also rejected — it still halts.
- **No new amendment ledger file, no new `.pipeline/` schema.** The evidence already travels in
  `build_review`'s diff; do not build transport for data that is already there.
- **No change to the #976 base-inheritance tolerance** or to the added/deleted branches.
- **No new grader input.** `assembleBuildReviewInputs` stays `(git, planPath)` — its input
  isolation is deliberate. The new rule is a static prompt rule only.
- No VERSION bump (operator-frozen pre-v1).

## Tasks

### Task 1 — Report tolerated self-amendments from `inspectSeal`

In `protected-artifact-seal.ts`:

- Add an exported `ProtectedArtifactSelfAmendment` interface: `{ path: string; sealedFingerprint:
  string; currentFingerprint: string }`.
- Widen the success arm of `ProtectedArtifactSealVerdict` to
  `{ ok: true; seal: ProtectedArtifactSeal; selfAmendments: ProtectedArtifactSelfAmendment[] }`.
- In `inspectSeal`, accumulate a `selfAmendments` array. In the fingerprint-mismatch branch,
  when `featureDesc && namesOwnFeature(path, featureDesc)`, push an entry instead of falling
  through silently, then continue.
- Return `{ ok: true, seal, selfAmendments }` from the success path.
- Ordering: the #976 base-inheritance check must still win for artifacts that are byte-identical
  to the base tip and do NOT name the current feature (unchanged). An own-feature artifact that
  is byte-identical to the base tip must be treated as inherited, **not** reported as an
  amendment — check `inheritedFromBase` before recording, so Story 1's last negative path holds.
- Replace the `TEMPORARY LOOSENING` comment with one describing the durable mechanism and citing
  #1047 and the ADR.

**Dependencies:** none.
Estimated: 5 min.

### Task 2 — Extend the seal test block

In `src/conductor/test/engine/protected-artifact-seal.test.ts`, rename the
`own-feature self-amendment loosening` describe block to reflect the durable behavior and
**extend** it (do not delete the existing cases — they still assert the tolerances):

- The two existing tolerate cases now additionally assert `selfAmendments` contains exactly the
  amended path with the sealed and current fingerprints.
- New: a clean workspace yields `selfAmendments: []`.
- New: an own-feature artifact whose content is byte-identical to the base tip is tolerated and
  reported as `selfAmendments: []` (inherited, not amended).
- The existing "different feature", "added", and "deleted" rejection cases stay byte-for-byte —
  they prove reporting did not weaken tamper detection.

**Dependencies:** Task 1.
Estimated: 6 min.

### Task 3 — Surface the advisory in the conductor

In `conductor.ts` at the `sealVerdict` site (~line 3764), in the `sealVerdict.ok` branch: when
`sealVerdict.selfAmendments.length > 0`, emit a single `console.warn` naming each amended path
and stating that the amendment must be justified by the approved plan and will be judged by
`build_review`. Do **not** set `protectedArtifactIssue`; the step must proceed. Keep the existing
`createProtectedArtifactSeal` call for the first-BUILD path exactly as-is.

**Dependencies:** Task 1.
Estimated: 4 min.

### Task 4 — Add the Scope sub-rule to the grader prompt

In `build-review-prompt.ts`, extend rubric item 2 (Scope) with an explicit sub-rule: files under
`.docs/architecture/`, `.docs/plans/`, `.docs/specs/`, and `.docs/stories/` are **already-approved
DECIDE artifacts**; a diff that modifies one is an amendment to an approved artifact and passes
Scope only if the approved plan justifies it — otherwise it is a Scope failure. Leave the four
rubric items, the all-or-FAIL rule, the completeness wording, and the JSON schema otherwise
unchanged.

**Dependencies:** none.
Estimated: 4 min.

### Task 5 — Assert the prompt rule and add the changelog entry

- Add/extend `src/conductor/test/engine/build-review-prompt.test.ts` to assert the rendered
  prompt contains the DECIDE-artifact Scope rule and still contains the four rubric items and
  the all-or-FAIL rule.
- Add a `## [Unreleased]` CHANGELOG entry describing the behavior change.
- Run `test/test_harness_integrity.sh` and the conductor test suite; both must pass.

**Dependencies:** Tasks 2, 3, 4.
Estimated: 6 min.

## Task Dependency Graph

```
Task 1 ──┬── Task 2 ──┐
         └── Task 3 ──┼── Task 5
Task 4 ───────────────┘
```

## Verification

- The daemon no longer halt-loops on a feature amending its own DECIDE artifact.
- Every tolerated amendment appears in the log and is subject to a grader rule that can FAIL.
- Third-party change, addition, deletion, and #976 base inheritance all behave exactly as before.
