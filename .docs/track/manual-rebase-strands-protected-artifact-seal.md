# Track: Manual rebase strands protected-artifact seal

Track: technical

Daemon/engine correctness fix in the protected-artifact seal rotation evaluator — no user-facing
product requirements; acceptance criteria live in stories. Operator confirmed 2026-08-09.

Chosen approach (B): provenance-based rotation verdict plus non-escalating refusal.
`evaluateProtectedArtifactSealRotation` currently refuses on a symmetric byte-equality test
(`head-differs-from-base`) that never asks who authored the divergence, so a feature merely *behind*
base — head lacks a protected artifact the base branch added after the merge-base — is refused and
mislabelled `feature-authored:`. `rotationRefusalVerdict` then converts that refusal into a HALT even
though `inspectSeal` itself passed. The fix asks the authorship question already answered by
`branchUntouchedInheritance` (merge-base `git diff --name-only <base>...HEAD -- <path>`), treats
base-only divergence as no violation, forbids a rotation refusal from downgrading a passing
inspection, and carries the classifying evidence on the existing
`protected_artifact_rebaseline_refused` event.

Rejected alternatives:
- (A) Hook seal rotation into manual/direct rebase completion — the filer's first hypothesis. Real
  but narrower: a manual rebase happens in an operator shell with no lifecycle hook to attach to,
  and the same false halt occurs with no rebase at all whenever a feature is behind base. The
  defensive rotation already exists to cover unhooked rewrites; it is the thing that is broken.
- (C) Non-escalation only — stop a rotation refusal failing a passing inspection, leave the
  byte-equality test as the rotation permission gate. Smallest diff, but leaves the misleading
  `feature-authored:` label (outcome 4 unmet) and leaves seals stranded on stale baselines
  (outcome 1 only partly met). Subsumed by B.

Sequencing constraint: `conduct reseal` (#1281,
`.docs/plans/no-operator-command-to-reseal-a-protected-decide-a.md`) is complementary — an
interactive operator-only *recovery* command that cannot satisfy this issue's no-operator-intervention
outcomes. No function-level conflict, but its Task 2 restructures `rotateProtectedArtifactSeal`
within the same file; land after it or rebase onto it.

Source: jstoup111/ai-conductor#1229
