# ADR: Protected-artifact seal hands self-amendment to build_review instead of halting

Status: APPROVED
Date: 2026-07-27
Refs: jstoup111/ai-conductor#1047, #976, #1024

## Context

`inspectSeal` in `src/conductor/src/engine/protected-artifact-seal.ts` currently carries a
TEMPORARY, operator-directed loosening: a protected DECIDE artifact
(`.docs/architecture|plans|specs|stories/*.md`) whose CONTENT changed mid-build no longer halts
the build if the artifact's filename stem names the CURRENT feature (date-prefix tolerant,
mirroring #1024). It was added to unblock feature
`2026-07-26-daemon-decide-phase-coherence-ownership-971`, which was stuck in a halt/rekick loop
because its own build agent legitimately amended its own architecture doc to reflect in-scope
work a `build_review` kickback had already flagged.

The loosening is blunt: it tolerates ANY content change to a feature's own artifact,
unconditionally, with no visibility into what changed and no re-approval. That reopens exactly
the case the seal exists to prevent — a build agent quietly rewriting its own approved
architecture doc so out-of-scope work looks pre-approved.

The structural difficulty is that **both** cases are the same actor making the same kind of
edit in the same worktree. No in-worktree provenance signal can separate them. Only *review*
can. So the question is not "how does the seal detect tampering" but "who reviews the
amendment, and how does it reach them."

## Decision

**The seal stops halting on own-feature self-amendment and stops tolerating it silently. It
reports the amendment, the engine surfaces it, and `build_review` judges it as a scope
question.**

Concretely:

1. `inspectSeal` returns the tolerated self-amendments on the success verdict
   (`{ ok: true, seal, selfAmendments: [...] }`) rather than silently `continue`-ing.
2. `conductor.ts` emits a visible, non-fatal advisory naming each amended path when that list is
   non-empty, so the amendment is never invisible to an operator reading the log.
3. The `build_review` grader prompt gains an explicit sub-rule under its existing **Scope**
   rubric item: a diff that modifies an approved DECIDE artifact under
   `.docs/architecture|plans|specs|stories/` must be justified by the approved plan; an
   unjustified self-amendment is a Scope FAIL.

   > **Amended 2026-08-12 by #1502:** the sub-rule admits a second justification source — a diff
   > modifying a protected DECIDE artifact is justified either by the approved plan **or** by an
   > operator `conduct-ts reseal` covering that path, judged against the rationale the operator
   > recorded. An amendment justified by neither remains a Scope FAIL, unchanged. A reseal
   > authorizes an amendment committed *after* BUILD entry, which no pre-BUILD plan can ever carry,
   > so the plan-only reading made every reseal permanently unsatisfiable (observed terminal on
   > #1223 across three dispatches). See
   > `adr-2026-08-12-operator-reseal-as-second-scope-justification`. Decisions 1 and 2 above are
   > unaffected and this ADR remains APPROVED.

No new module, no new persisted state, no new gate, no new human checkpoint.

## Why this option

The intake offered three options. Weighing them against the operator constraint (keep it tightly
scoped) and against the failure that produced the intake:

- **Require an explicit re-seal / re-approval step.** Rejected. It reintroduces a blocking
  checkpoint into an autonomous daemon loop — which is precisely the stall #1047 was filed to
  end. It trades a silent-tolerance risk for a guaranteed operational stall, and it is the most
  machinery of the three.
- **Halt with the diff in the kickback message.** Rejected. Better diagnostics, but it still
  halts, so `2026-07-26-daemon-decide-phase-coherence-ownership-971` would still spin. It solves
  the visibility half of the problem and re-breaks the liveness half.
- **Allow the amendment, but route it into the existing review trail.** **Chosen.** This repo
  already runs an LLM gate whose literal mandate is scope-vs-plan comparison, and that gate
  already *receives* the amendment: `assembleBuildReviewInputs` computes
  `git diff merge-base(baseRef, HEAD)..HEAD`, and the amended `.docs/` file is a committed file
  in that range. The evidence is already in front of the right reviewer. The only genuine gap is
  that nothing tells the grader that DECIDE artifacts are approval-bearing rather than ordinary
  docs. Closing that gap is a prompt rule, not a subsystem.

This also matches the repo's Design Principle in spirit: the deterministic part (detect the
change, name it, log it) stays deterministic in the seal, and only the part that genuinely
requires judgement (is this amendment in scope?) is dispatched to an LLM — one that is already
being dispatched anyway, at no extra cost.

## Assumptions

- **The amendment is committed before `build_review` runs** — required for it to appear in the
  grader's `..HEAD` diff. Confidence ~85%, *inferred*: `build_review`'s prerequisite is `build`,
  and the `build` step enforces `runPerTaskCommitFloor`, so task-scoped work is committed before
  the gate. Impact if wrong: an amendment made outside a task's commit would be tolerated by the
  seal and absent from the grader's diff.
- **Residual risk accepted, not designed around.** Even in that case the amendment is not
  invisible: decision (2) logs it at every subsequent BUILD/SHIP seal verification, and it must
  still pass `finish`/PR review to ship. Story 3's negative path pins this. If practice shows
  uncommitted amendments are common, the follow-up is to pass the reported paths into the grader
  prompt as an explicit input — deliberately deferred rather than built speculatively.

## Consequences

- The daemon no longer halt-loops on a feature amending its own DECIDE artifact.
- Silent tolerance is gone: every tolerated amendment is named in the log and is subject to a
  grader rubric rule that can FAIL the build.
- Third-party tampering, additions, and deletions are all unchanged — they still halt exactly as
  before, as does the #976 base-inheritance tolerance.
- The existing "own-feature self-amendment loosening" test block in
  `src/conductor/test/engine/protected-artifact-seal.test.ts` is extended, not deleted: the same
  tolerances must still hold, and must now also report.

> **Amended 2026-08-22 by #1805:** prd_audit now runs on every feature/tier/track, judges stories' acceptance criteria as authority, declares .docs/stories and .docs/specs in its gate surface, grades findings PASS/FIXABLE/PLAN_GAP/OVER_SCOPE, and owns the only bounded plan-task kickback; reseal-rationale and scope-containment judgement move to its OVER_SCOPE grade (adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback).
