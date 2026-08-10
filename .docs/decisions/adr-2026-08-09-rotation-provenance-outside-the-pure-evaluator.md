# ADR: rotation provenance is resolved outside the pure evaluator

**Status: APPROVED**
**Date:** 2026-08-09
**Issue:** jstoup111/ai-conductor#1229
**Stem:** `manual-rebase-strands-protected-artifact-seal`
**Related:** `adr-2026-08-09-seal-rotation-authorship-predicate`

## Context

`adr-2026-08-09-seal-rotation-authorship-predicate` requires the rotation verdict to ask a git
question — did HEAD change this path since the merge-base with the base branch?

The function that must act on that answer, `evaluateProtectedArtifactSealRotation`
(`src/conductor/src/engine/protected-artifact-seal.ts:283`), is deliberately **pure**. It takes
preloaded blob maps (`workspaceArtifacts`, `headArtifacts`, `baseTipArtifacts`) plus a resolved
`baselineAncestry` string, and performs no I/O. Its impure sibling
`evaluateProtectedArtifactSealRotationInRepository` (`:439`) does all the git work and hands the
results down.

That split is load-bearing, not incidental. The pure function is the unit-test seam for the entire
rotation decision table — 11 direct references in
`src/conductor/test/engine/protected-artifact-seal.test.ts` — which is what makes the adversarial
cases (feature-authored edit, uncommitted edit, deletion, base-only addition) cheap to enumerate
exhaustively without constructing a git repository per case. For a tamper-detection boundary, cheap
exhaustive negative-path testing is the property most worth protecting.

The obvious implementation — call `branchUntouchedInheritance` from inside the loop in
`evaluateProtectedArtifactSealRotation` — would dissolve that seam. Every decision-table test would
then need a real repository or a git mock, and the adversarial cases would get more expensive to
write at exactly the moment the boundary is being modified.

Note that `baselineAncestry` is already precisely this pattern: a git question
(`merge-base --is-ancestor`) resolved by the wrapper and passed into the pure function as a
three-valued datum, including its own indeterminate case (`'unresolvable'`). The precedent for
the shape being chosen here already exists in the function's current signature.

## Decision

**Git-dependent provenance is resolved by `evaluateProtectedArtifactSealRotationInRepository` and
passed into `evaluateProtectedArtifactSealRotation` as data.**

1. The pure evaluator gains an input describing, per path, whether the feature authored the
   divergence. It performs no I/O and imports no git helper. No `execa` call may be added to it.
2. The value is three-valued, mirroring `baselineAncestry`: authored, not-authored, and
   indeterminate. Indeterminate is not collapsed into either answer at the boundary — the pure
   evaluator decides what indeterminacy means, and per
   `adr-2026-08-09-seal-rotation-authorship-predicate` item 2 it means feature-authored, fail-closed.
3. The repository wrapper resolves it using the existing merge-base authorship probe, so there is one
   definition of provenance in the module rather than two.
4. Resolution is scoped to the paths that actually diverge, preserving the existing property that a
   feature on the common ancestor path performs no extra git work.

## Alternatives considered

**Call the probe inline from the pure evaluator.** Simplest diff, one fewer parameter. Rejected: it
converts the module's exhaustively-tested pure decision table into an I/O-bound one, and does so in
the same change that loosens a security predicate. Precisely the wrong time to make negative-path
coverage more expensive.

**Inject a probe callback into the pure evaluator.** Keeps the function testable via a stub and
avoids precomputing for paths that are never reached. Rejected: it makes the function async and
effectful in signature if not in fact, and every test must now supply a callback whose behavior is a
second thing to get right. Passing resolved data is simpler to assert against and cannot be stubbed
inconsistently with the real probe's semantics.

**Resolve provenance for all protected paths up front.** Uniform and simple. Rejected: it performs
git work proportional to the whole protected tree on a path where only the diverging paths matter,
and the diverging set is already computed.

**Fold provenance into the existing blob maps** (e.g. a fourth map of merge-base blobs, comparing
bytes). Rejected: it reintroduces a byte-comparison answer to an authorship question — the exact
conflation `adr-2026-08-09-seal-rotation-authorship-predicate` exists to correct — and a
merge-base blob comparison would still misread a path the feature edited and then reverted.

## Consequences

- The rotation decision table stays unit-testable without a git fixture. The adversarial cases
  required by the architecture review's Condition 3 remain cheap to write and read.
- One new input on an exported function's input interface. `evaluateProtectedArtifactSealRotation` is
  exported and referenced by tests, so its signature change is visible to the test suite by design —
  the compiler enumerates every call site that must account for the new dimension.
- The indeterminate case is represented in the type rather than pre-collapsed, so the fail-closed
  rule from `adr-2026-08-09-seal-rotation-authorship-predicate` is expressed once, in the place that
  decides, and cannot be silently softened at the resolution boundary.
- End-to-end coverage of the real git behavior still belongs to the repository wrapper and to the
  reproduction story required by the review's Condition 6; this decision does not substitute unit
  tests for that.
