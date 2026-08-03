# Conflict Check: Plan-scope containment at the commit boundary

**Date:** 2026-08-02
**Stories:** `.docs/stories/pipeline-commits-files-outside-the-active-plan-bef.md`
**Scope of check:** the six stories against each other, against existing engine behavior, and
against open GitHub issues.

**Verdict: CLEAN, with one HIGH-severity interaction (C1) whose mitigation is binding on the plan.**

## Story-to-story

No contradictions. TI-3 (abstain on absent evidence) and TI-2 (refuse on violation) are
disjoint by construction: TI-3 governs cases with no usable data, TI-2 requires a resolved
task row with a non-empty `files` set. TI-4's widening is additive to TI-2's allowed set and
never subtractive. TI-5 observes; it never blocks. No two stories write the same file with
different intent.

One deliberate ordering constraint: TI-1 must land before TI-2, because TI-2's data source is
the field TI-1 seeds. Reflected in the plan's dependency tree.

## C1 — HIGH — Unavoidable compile-only adaptations (#1258) would be refused

**The conflict.** Open issue #1258 documents a real BUILD/build-review spin where a
type-level change made an existing fixture at `test/engine/group-core.test.ts:1046`
uncompilable. The approved plan did not own that file; the batch review recorded it as
`known_outside_scope` and approved anyway; the full test-inclusive typecheck nonetheless
required an edit there. Today that edit is merely *ungoverned*. Under this feature it becomes
**actively refused at the commit boundary**.

Without mitigation this feature makes #1258 strictly worse: the daemon already alternated
"removing, restoring, casting, and changing the same fixture" through three build-review
failures before an operator parked it. Adding a hard commit refusal to that loop converts a
spin into a wedge.

**Why it is not a blocker.** The scope-disposition path (TI-4) is exactly the contract #1258
says is missing — it names the file, records why the planned behavior requires touching it,
and puts that reasoning in the reviewed diff. #1258's own stated root cause is "no shared
contract for compile-only compatibility edits discovered after planning." This feature
supplies one.

**Binding mitigations, carried into the plan:**

1. The refusal message MUST name the disposition path concretely — the file to create and the
   required fields — not merely say "record a scope disposition." A build agent that cannot
   discover the escape hatch from the error text will delete work instead, which is the #989
   harm.
2. The refusal MUST be distinguishable from a generic commit failure so the loop does not
   read it as a test failure and retry blindly.
3. A story-level test asserts the refusal message contains the disposition instructions
   (folded into TI-2's happy path).

**Residual risk: accepted.** An agent may still fail to use the hatch and spin. That is
bounded by the existing kickback budget and halts for a human, which is the correct terminal
state for a plan-implicating decision under #989.

## C2 — MEDIUM — Concurrent dispatch makes the stamp ambiguous (#531)

**The interaction.** #531 documents that under parallel task dispatch the single global
`.pipeline/current-task` stamp oscillates between one id and absent, because the #494 overlap
guard removes it when a second dispatch arrives. If the stamp is wrong, this feature checks a
commit against the *wrong* task's declared paths and can refuse legitimate work.

**Resolution: no change needed; already covered.** TI-3 requires abstention when no `Task:`
trailer is present, which is exactly the state #531 produces (stamp absent → `prepare-commit-msg`
does not stamp → no trailer → abstain). The failure mode under concurrency is therefore
"check silently does nothing," not "check refuses wrongly." That is the correct fail-open
posture and is consistent with #773's demotion of the whole stamp apparatus to telemetry.

**Not resolved here:** the mis-stamp case (stamp present but belonging to a different in-flight
task) remains possible and would produce a wrong refusal. This is #531's defect, not this
feature's, and #531 is the correct place to fix it. Noted, not adopted.

## C3 — MEDIUM — Hook-based enforcement is bypassable / may not be live (#627, #625)

`writeGitHooksAndWire` is deliberately fail-open, #625 documents worktrees running stale
engine `dist`, and #627 documents Bash-mediated bypasses of the session mutation gate.

**Resolution.** Git hooks fire regardless of how git is invoked, so #627's session-hook
bypasses do not apply to this check. The fail-open wiring and stale-`dist` cases do apply, and
are precisely why TI-5's engine-side backstop is in this feature rather than deferred. The
architecture review makes shipping the backstop in the same feature a binding constraint.

## C4 — LOW — Overlap with `build_review`'s Scope rubric

Two gates now judge scope. This is intentional defense in depth and not double jeopardy: they
ask different questions (paths versus behavior) at different times (commit versus post-build),
and this feature changes neither `build_review`'s prompt nor its `remediate` routing. A commit
refused by the hook never reaches `build_review`, so no finding is raised twice.

## C5 — LOW — `.docs/scope-dispositions/` and the docs-guard

The docs-guard default-denies `.docs/` writes during BUILD. TI-4 requires writing there
mid-build. Resolved by adding the prefix to `DOCS_WRITE_ALWAYS_ALLOWED`, the same list that
already carries `.docs/release-waivers/`. No conflict with `build_review`, which treats only
`.docs/architecture|plans|specs|stories` as approved-artifact Scope failures — the new prefix
is not among them.

## C6 — LOW — Reviving `t.files` on task rows

TI-1 populates a field the dead hook block already reads. Checked for other consumers: the
only reader is that block, and `normalizeTasks` ignores unknown fields, so no existing
consumer changes behavior. `TaskStatusRecord`'s open index signature makes the addition
non-breaking. `rebase-translate.ts` rewrites only `commit` shas and is unaffected.

## Checked and found non-conflicting

- **#623** (machine-readable plan dependencies) — touches `Dependencies:`, not `Files:`. Would
  make this feature's parsing more robust later; no contradiction.
- **#540** (plans naming unverified symbols) — orthogonal; concerns symbol existence, not path
  containment.
- **#565 / #550** (BUILD can reach DECIDE steps) — this feature narrows what BUILD may write,
  moving in the same direction.
- **#1173** (build review repeats aggregate verification) — verification cost, not scope.
- **#1250** (implementation-only remediation falsely requires DECIDE rewind) — touches the
  `remediate` path this feature deliberately leaves unchanged. Worth watching: more scope
  findings routed to `remediate` could increase exposure to #1250. Not a conflict, since this
  feature reduces the number of scope findings reaching `build_review` at all.

## Open issue scan

Reviewed the open backlog for scope, plan, commit, and hook overlap. No open issue specs the
same mechanism; no duplicate work found. #1258 is the only issue whose behavior this feature
materially changes, addressed in C1.
