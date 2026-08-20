# Coherence waiver: plan-tasks-can-declare-a-protected-artifact-outcom

Waives: outcome-1, outcome-2, outcome-3, outcome-4, outcome-5, outcome-6, story-4

Rationale: Two independent groups, each deliberate and each recorded rather than papered over.

**outcome-1 through outcome-6 — the intake's stated outcomes are superseded by a root-cause
finding.** ai-conductor#1736's Desired outcome section was written against the filer's diagnosis:
that `build_review`'s completeness rubric is diff-anchored and should be taught to see outcomes
satisfied in a sealed artifact routed through the default branch. Investigation established that
the rubric behaved correctly and the defect is upstream. A plan task required an outcome BUILD is
structurally forbidden to produce — an amendment to another feature's protected DECIDE artifact.
`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` (APPROVED) already governs this:
"DECIDE mutates the artifact itself. DECIDE never emits a task that mutates a DECIDE artifact." Its
§4 ordered mechanical enforcement at authoring and land; that enforcement shipped with a hole
(`scanPlanProtectedTargets` scans a task's `**Files:**` paths or its body prose, never both), and
the incident task declared a `**Files:**` line, so the foreign ADR in its body was never scanned.

This spec fixes that cause. It therefore delivers none of the six rubric-behavior bullets as
written, and does not claim to:

- outcome-1, outcome-2, outcome-6 describe a completeness rubric that declines a finding on
  sealed-artifact grounds. That same ADR rejects the enabling mechanism by name — "Loosen the seal
  — tolerate any amendment the plan explicitly declares. Rejected: it converts the seal from tamper
  detection into a declaration checkbox" — and §5 accepts the consequence: "a residue that needs a
  human is acceptable where a bypass is not." Story 5's runbook documents that residue's recovery.
- outcome-3 ("a genuinely missing outcome still FAILs") is preserved by construction, since no
  rubric change is made. Preservation is not delivery, so it is waived rather than claimed.
- outcome-4 requires the projection digest to change on reseal; reseals are deliberately excluded
  from that digest (`build-review-inputs.ts:197`, "excluded from shared identity"). Changing it is
  rubric work, out of this spec's scope.
- outcome-5 (a no-op kickback must not decrement the build-kickback budget) is owned by #1629,
  whose spec is merged and whose build is in flight as PR #1734. Delivering it here would collide
  with that branch.

The operator directed this scope explicitly after reviewing the root-cause evidence, and chose to
record the unmet bullets on the ledger via this waiver rather than rewrite the issue's stated
outcomes.

**story-4 — delivered at DECIDE, so it correctly carries no task.** Story 4 corrects that ADR's §3
sealed-directory list from four entries to five; `.docs/decisions` was omitted in prose though
`PROTECTED_ARTIFACT_DIRECTORIES` has enumerated five throughout, and the artifact at the centre of
#1736 was an ADR under exactly that omitted directory. The file lives under `.docs/decisions/` and
is therefore protected. Emitting a plan task to mutate it would commit the precise violation this
feature exists to prevent, so the amendment was performed during this DECIDE pass and committed on
the spec branch in that ADR's own codified note form (its §1). The story-coverage layer reads the
plan's `**Story:**` lines and cannot see a DECIDE-time delivery, so it reports a gap where the
correct engineering answer is the absence of a task.
