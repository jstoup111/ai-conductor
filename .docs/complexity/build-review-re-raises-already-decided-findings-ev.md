# Complexity: build_review re-raises already-decided findings every lap and never converges

Tier: L
Stacked-Delivery: approved

## Rationale

- **Supersedes approved review-spine decisions.** The change amends:
  - `adr-2026-08-13-engine-managed-build-review-rubric-branches` §2, where the snapshot excludes
    prior review state, and §7, the whole-rubric cache identity.
  - `adr-2026-08-29-build-review-remediate-case-adjudication` D1 ("rubrics receive neither sibling
    findings nor case history"), including its rejected "prior history" alternative.
  - `adr-2026-08-13-stable-build-review-finding-dispositions` §2.
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D5.1, where exact id is
    the only admitted equivalence.

  It also resolves `adr-2026-08-21-review-bound-by-plan-done-when-criteria` Option C, the deferred
  lap-monotonic engine. Six specs have already amended mixed-laps D5, and open spec PR #2878 edits
  two of these ADRs too.
- **New durable per-lap record.** Each lap's reviewed-hunk set is keyed by path and the
  `+`/`-`-only hunk content hash. It must survive rebases and line shifts. A `base-refresh` rebase
  must force a full lap and a `feature-repair` restack must not.
- **Every rubric's projection and cache identity change.** This covers testQuality, security,
  implementationQuality, and custom rubrics. Their projections become delta-scoped with full-diff
  reference context. The testQuality counterfactual preflight must stay whole-diff.
- **Engine-enforced admission.** A later-lap finding anchored in a settled hunk is admitted as
  blocking only when its named cause hunk is verified to be in the delta. Otherwise it is advisory,
  which interacts with the #3298 advisory bucket and the effective-verdict order.
- **Convergence bound on top of #3124.** Repair-provenance lineage is derived from hunk provenance
  and joins the existing recurrence lineage limit of 3.
- **Provider contract change.** The rubric skill contracts and the `remediate` judge context, which
  gains prior finding summaries and locations, change for both Claude and Codex.
- **Precedent.** The related #3271 respec failed at M and succeeded at L with a full review.
