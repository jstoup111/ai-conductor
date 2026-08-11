# Complexity: Manual rebase strands protected-artifact seal (#1229)

Tier: M

## Rationale

**Signals present (push above S):**

- **A safety boundary is being modified.** `evaluateProtectedArtifactSealRotation` is the
  tamper-detection surface for DECIDE artifacts. Loosening its refusal condition from a symmetric
  byte-equality test to an authorship test must be proven not to admit any feature-authored
  BUILD/SHIP edit that halts today. That proof — an explicit negative-path story with cases that
  must still halt — is a first-class part of the work, not a test afterthought.
- **Two coupled behavioral changes, not one predicate swap.** The provenance test changes *which*
  divergences refuse rotation; the non-escalation rule changes *what a refusal means* to
  `verifyExistingProtectedArtifactSeal`. They interact: with non-escalation alone the seal strands;
  with provenance alone a refusal on some other path can still fail a passing inspection. Both
  paths through `rotationRefusalVerdict` need to be reasoned about together.
- **Telemetry semantics change.** `emitRotationRefusal` currently labels every
  `head-differs-from-base` refusal `feature-authored:`, which is the string daemon triage reads.
  Correcting the label and carrying the classifying evidence (merge-base, whether HEAD touched the
  path, the base commit that introduced it) is an additive payload change to an existing
  `ConductorEvent` variant plus its daemon renderer.
- **A live sequencing constraint against in-flight work.** `conduct reseal` (#1281) restructures
  `rotateProtectedArtifactSeal` in the same file. No function-level conflict, but the ordering has
  to be decided deliberately — which is exactly what conflict-check exists to record.
- **Documentation is part of the contract** — `docs/runbooks/stalled-or-stuck-feature.md`'s
  protected-artifact recovery section describes the manual-reseal path this change makes
  unnecessary for the behind-base class.

**Signals absent (hold it below L):**

- No new models, no new persistence schema, no new CLI verb, no new event variant, no
  authentication, no external integrations, no network calls.
- No state machine; the change is a deterministic predicate plus a verdict-composition rule.
- Every primitive is already present and being reused — `branchUntouchedInheritance` already
  implements the merge-base authorship test this change lifts into the rotation evaluator.
- Estimated story count is mid-single-digit, all mechanically verifiable against real git
  fixtures with no third-party boundary involved.

**Verdict: Medium.** Architecture diagram, a lightweight architecture review, conflict-check, and
coherence-check are in scope. The blast radius is one module and one event payload, so nothing here
warrants the full Large treatment.
