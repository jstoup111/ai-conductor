# Conflict-check: build-reports-step-completed-status-done-while-lea

**Source:** jstoup111/ai-conductor#1270 · **Track:** technical · **Tier:** M
**Date:** 2026-08-03
**Verdict:** CLEAR (no blocking conflicts) — one HIGH interaction with in-flight #1227 requiring an
explicit coordination note, plus two LOW notes.

## Stories reviewed

Stories 1–8 (`.docs/stories/build-reports-step-completed-status-done-while-lea.md`). They touch four
seams: the `CompletionContext` type + `completionCtx` builder (`artifacts.ts:854-913`,
`conductor.ts:1191-1364`), the `build` completion predicate (`artifacts.ts:1747-1938`), the
budget-exhaustion escape and retry hint (`conductor.ts:5640-5680`, `:8038-8102`), and the
suite-evidence shape (`full-suite-evidence.ts:28-71`, written at `full-suite-verifier.ts:649,799`).

## Internal consistency (story-vs-story)

| Pair | Assessment |
|---|---|
| S2 (predicate blocks) vs S4 (no-op build completes) | No contradiction — disjoint by construction. S2 fires only on a non-empty porcelain result; S4's cases all produce an empty one. The predicate is total: empty ⇒ done, non-empty ⇒ not-done, absent/throw ⇒ done. |
| S2 (predicate) vs S3 (escape) | Complementary, not duplicative. They guard **different** control-flow paths to the same outcome; S3's whole justification is that it is *not* reached through S2. S6 forces both onto one shared helper so their fail directions cannot drift apart. |
| S3 (escape refuses to route) vs S5 (retry hint self-heals) | Consistent and ordered: S5 operates *within* the retry budget, S3 only *after* it exhausts. A build that self-heals under S5 never reaches S3. |
| S2 (dirty blocks) vs S7 (rebase autostash may leave dirt) | Potential tension, deliberately surfaced rather than resolved silently. S7 exists precisely to pin the post-rebase closure path's behavior by test instead of inheriting S2's default by accident. |
| S6 (fail-open on absence) vs S1/S2/S3 | Consistent — S6 is the single statement of the fail direction that S1, S2 and S3 each cite; it adds no independent behavior. |
| S8 (evidence label) vs S2/S3 | Fully independent. S8 adds a written field with no reader and no gate effect; no story depends on it, and it depends on none. |

No state conflicts, no resource contention, no ordering contradictions.

## Cross-feature conflicts (in-flight spec branches, same files)

**C1 — #1227 `pipeline-commits-files-outside-the-active-plan-bef` — HIGH interaction, non-blocking.**

That spec adds deterministic plan-scope containment at the **commit** boundary: a
`plan-scope-containment.ts` module, a `conduct-ts scope-check` CLI called from `COMMIT_MSG_HOOK`,
a `files` field on seeded task rows, and an engine backstop beside `per-task-commit-floor.ts`.

- **File overlap: minimal.** The only shared symbol is `seedTaskStatus`, which this spec's build
  predicate calls (`artifacts.ts:1776`) and #1227 extends with an additive per-row `files` field.
  Additive on a field this spec never reads — no textual or semantic collision.
- **Behavioral interaction: real, and worth stating.** #1227 can **refuse a commit**; this spec
  **refuses to complete without one**. Landed together and both enforcing, a session whose commit is
  rejected for scope would leave the work uncommitted, and this floor would then correctly refuse
  completion — the session must widen with a `Scope:` trailer or narrow the change. That is the
  designed behavior of both, not a deadlock, and it is bounded by the existing retry budget on this
  side and the `Scope:` escape hatch on that side.
- **Mitigation already in place:** #1227 ships its hook **report-only**, with enforcement as a
  deliberate follow-up flip "earned on live data" (its architecture-review F6). So at merge time the
  interaction is inert. **Coordination requirement:** whichever of the two flips #1227's hook to
  enforcing must re-verify this interaction against live build data first. Recorded here so the
  decision is not made blind.
- **No merge-order dependency.** Either can land first.

**C2 — #1173 `build-review-repeats-aggregate-verification-despit` — LOW.**
Adds a scoped test-invocation surface: a `test_suite` config template key, validator changes in
`config.ts:1152+`, a scoped-run module, and BUILD/`build_review` call-site updates. It changes *how*
the suite is invoked; Story 8 changes *what is recorded about* a run. Distinct files
(`config.ts` + a new module vs `full-suite-evidence.ts`). The one shared surface is the
`test_suite` step conceptually, not textually. If both land, Story 8's field simply describes
whichever invocation ran. No coordination required.

**C3 — #1233 `changelog-unreleased-is-a-shared-write-target-conf` — LOW, historical only.**
This is the feature the #1270 incident was *observed on*; it merged as `a57e7221b`. It is the
setting of the bug report, not a code conflict. No overlap.

Every other in-flight spec branch was checked by name against this spec's four seams; none touches
`artifacts.ts`'s completion predicates, `conductor.ts`'s build retry loop, or the suite-evidence
shape.

## Cross-feature conflicts (open GitHub issues)

| Issue | Relationship | Verdict |
|---|---|---|
| **#1249** BUILD repair preserves stale wiring pass | Same incident *class* (evidence that predates current state), different mechanism: group-membership retention in `resolveGroupMembership`, not working-tree observation. Once this floor lands, a build can no longer hand off dirty — which removes the pathway that produced #1270's particular stale block — but #1249's defect survives independently and is unfixed here. ADR Decision 8 states this explicitly so neither issue is closed on the other's evidence. | No conflict; **do not close #1249 on this** |
| **#1269** Daemon parks needs-human when a gate blocks on unsatisfied prerequisites | The recovery-routing half of the same observed incident. This spec prevents the dirty hand-off that *creates* such a block; #1269 owns what the daemon does when one occurs anyway. Complementary, no shared file. | No conflict |
| **#1252** Missing task telemetry exhausts BUILD retries after verified work | Also lands in the build retry loop's exhaustion tail. Both interact with `anyAttemptMovedHead`. If #1252 is specced later it MUST account for Story 3's guard, which narrows when the escape may fire. Flagged for that spec's conflict-check, not blocking here. | Coordinate if #1252 is specced |
| **#1176** BUILD remains active after all plan tasks resolve | Touches build-completion timing. This spec adds a conjunct that can only *delay* completion, so it is directionally aligned with the complaint's cause rather than its remedy. Worth a note in #1176's own DECIDE. | No conflict |

## Resource and ordering analysis

- **No shared mutable state.** The probe is read-only (`git status --porcelain`); it writes nothing.
- **No new file, lock, marker, or sidecar** is introduced. Story 8's field is additive within an
  existing atomically-written file (`full-suite-evidence.ts:245-277` writes to a tmp path then
  renames), so no concurrent-write hazard is added.
- **No ordering constraint against other features.** Within this spec, Stories 1 → 2 → 3 → 5 are
  strictly ordered by dependency; 4, 6, 7, 8 attach where the plan places them.

## Verdict

**CLEAR.** No blocking conflict. C1 carries a coordination requirement that has been written into
this spec's record rather than left implicit; C2 and C3 are informational.
