# Architecture Review: Framework-agnostic tautology scoped-run classification

**Date:** 2026-08-17
**Source:** jstoup111/ai-conductor#1682
**Tier:** M — lightweight review
**Decision record:** `adr-2026-08-17-framework-agnostic-tautology-scoped-run.md` (APPROVED)
**Verdict:** APPROVED to proceed to stories.

## Scope reviewed

The Tautology preflight's scoped-run classification path, the evidence it produces, the consumers of
that evidence, and the retention of runner output when the preflight fails for infrastructure
reasons.

## Findings

### F1 — The defect is a fallback that changed meaning underneath its callers (confirmed)

`classifyTautologyScopedFailure` was written when `collection-failure` meant "stop the rubric".
`#1593` redefined it to mean "valid RED counterfactual" without revisiting the fact that the same
bucket is also the classifier's catch-all for unrecognized output. The two changes are individually
reasonable and jointly produce a fallback that promotes "I do not recognize this" to "this is proof".

Confidence 95%, basis verified: the regexes and the fallback are read directly at
`step-runners.ts:196-203`, and the exclusion that makes `collection-failure` RED is read at
`build-review-tautology-preflight.ts:407`, with its rationale in the comment above it.

**Architectural implication.** A catch-all whose semantics are meaningful is a latent defect
regardless of how many patterns precede it. The fix must remove the fallback's ability to carry
meaning, not add patterns in front of it.

### F2 — The engine asserts more than its evidence supports (confirmed)

`test-failure` and `collection-failure` are claims about what happened *inside* the runner, derived
from text the engine cannot interpret portably. The only portable fact available at that seam is the
process outcome. Naming a variant `nonzero-exit` is not cosmetic: it stops the type system from
carrying an unfounded claim into the projection and into a judging skill that is instructed to treat
the classification as authoritative.

Confidence 99%, basis verified: `runKind` is projected into `preflightEvidence.scopedRun`
(`build-review-coordinator.ts:154`) and the skill's input contract documents it as the "run kind"
(`skills/build-review-tautology/SKILL.md:28`).

### F3 — The internal precedent already exists and was not followed (confirmed)

`scoped-run.ts:97-104` classifies the other scoped runner purely by exit code, with process-level
conditions handled separately. Two scoped runners in one engine disagreeing on whether runner output
is interpretable is an architectural inconsistency in its own right; this change removes it.

Confidence 100%, basis verified: file read in full.

### F4 — Deleting `no-tests` removes a working detection for two frameworks (accepted risk)

This is the one genuine loss. It is accepted because the detection's *outcome* — an infrastructure
failure — is a no-verdict, and #1682's central complaint is that no-verdict deadlocks the gate.
Relocating it to the judge converts an unroutable stall into a routable finding.

**Condition on acceptance:** the judging skill must be given the rule explicitly. Deleting the bucket
without D4 would silently convert a detected no-test run into RED, which is a regression against
desired outcome 3 with nothing standing in its place. D4 is therefore not optional polish; it is
load-bearing, and the review's approval is conditional on it landing in the same change.

### F5 — Outcome 5 invites a parallel telemetry channel (confirmed, avoided)

The issue asks for output "retrievable afterward from the feature's `.pipeline/` evidence" and notes
that `.pipeline/build-review-preflight/` is empty. That directory is the disposable checkout,
removed on every outcome by design (`build-review-tautology-preflight.ts:437`). Writing evidence
there — or into any bespoke sidecar — would be a second channel invisible to every bus consumer. The
event-spine decision procedure was run: the concern is an occurrence, no exception applies, and the
remedy is an additive optional field on an existing variant.

Confidence 98%, basis verified: cleanup is unconditional in the `finally` block; the event and its
persistence wiring are read at `build-review-coordinator.ts:245` and `event-sinks.ts:15`.

### F6 — The remaining false-RED edge is unobserved and deliberately left open (noted)

A disposable checkout that cannot run tests at all (missing installed dependencies, in a bare
`git worktree add --detach`) exits non-zero and counts as RED. Node survives this accidentally
because module resolution walks up to the real `node_modules`; a bundler-based project may not.

Confidence 60%, basis inferred — no instance has been observed, and no reproduction was attempted.
This is explicitly *not* treated as load-bearing for the design: the control run that would close it
is recorded in the ADR as an additive follow-up, and the change neither worsens nor depends on this
edge.

## Assumptions surfaced

| Assumption | Confidence | Basis | Impact if wrong | How to confirm |
| --- | --- | --- | --- | --- |
| The reported deadlock is fixed on `main` and the issue's evidence predates `#1593` | 90% | inferred — `scoped-run-collection-failed` is unreachable in current code; the affected project was not available on this machine to check its installed engine version | The change is still correct, but the issue's headline symptom would need a separate fix; nothing in this design changes | Read the affected project's installed `conduct-ts` version against `v0.101.x` |
| No consumer outside the preflight and its projection reads the removed reason strings | 97% | verified — repository-wide grep over `src/`, `skills/`, `docs/`, `.agents/` returned only the preflight, the classifier, and their tests | A consumer would break on a removed union member | Re-run the grep at implementation time before deleting |
| The judging skill can reliably tell "no test executed" from a bounded excerpt | 75% | inferred — the excerpt is head+tail bounded at 16 KB and runners announce an empty run prominently, but this is a model judgement with no mechanical floor | Desired outcome 3 is weakly met; a no-test run passes as RED | Exercise the acceptance case against both an empty-selection and a real-failure excerpt |

None of these is load-bearing in the blocking sense: the design does not change under any of their
negations. They are recorded so the builder does not re-derive them.

## Alignment checks

- **Design Principle (machinery vs judgement):** satisfied. Bookkeeping stays mechanical; the one
  genuinely interpretive question moves to the judge with a schema-constrained answer. The change
  removes an exception list rather than growing one.
- **Event spine:** satisfied. Extends the existing union; no new channel, no stamped artifact.
- **Scope:** consumer-facing. The mechanism runs in every consumer's BUILD phase.
- **Provider agnosticism:** satisfied. Engine TypeScript plus provider-neutral skill prose.
- **Third-party calls in tests:** satisfied. The scoped run is an injected dependency
  (`TautologyPreflightDependencies.runScoped`); no test needs a real runner or network.

## Conditions of approval

1. D4 (the judging-skill rule) lands in the same change as the union narrowing — see F4.
2. The removed reason strings are re-grepped immediately before deletion — see the assumption table.
3. `docs/explanation/gates.md` records the exit-code contract in the same change, per this
   repository's documentation-upkeep rule.
