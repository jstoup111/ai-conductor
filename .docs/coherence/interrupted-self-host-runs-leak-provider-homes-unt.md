# Coherence: Worktree-local provider scratch lifecycle

**Date:** 2026-08-10
**Tier:** M
**Track:** technical — the `fr` row class is omitted because there is no PRD. Outcomes are the intake's Desired-outcome bullets from jstoup111/ai-conductor#1223, in bullet order.

Every `covered` verdict below was confirmed by reading the counterpart artifact file, not inferred from a plausible id.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-4 | covered | "A normally completed provider attempt leaves no provider-home directory behind." Story 4's happy path asserts the home and lease no longer exist after teardown, and prunes the empty run directory. |
| outcome | outcome-2 | story-5 | covered | "Deterministically identifies and removes that attempt's orphaned provider home without deleting any active provider home." Story 5's happy path removes only dead-owner homes; its negative paths retain on all five uncertain states, which is what protects an active home. |
| outcome | outcome-3 | story-1, story-2 | covered | "Associated with a canonical repository, feature, run, and attempt identity rather than discoverable only through a random directory name." Story 1 puts run and attempt in the path; Story 2 puts repository, slug, run, attempt, pid, and start time in the lease. |
| outcome | outcome-4 | story-6 | covered | "Feature completion or worktree cleanup removes all remaining temporary storage owned by that feature while preserving any durable run-state." Story 6 asserts both halves — scratch gone after removal, relocated run-state still present. |
| outcome | outcome-5 | story-1 | covered | "Cleanup behavior remains correct if #564 relocates durable run-state outside the worktree." Story 1's negative path builds `.pipeline` as an outward symlink and asserts the scratch root is unaffected. |
| outcome | outcome-6 | story-5 | covered | "Works on supported Linux and macOS hosts without requiring systemd, launchd, cron, or operator-installed cleanup configuration." Covered only after this pass: Story 5 originally asserted neither half. Two happy-path criteria and one Done-When were added, and plan Task 15b was added to implement them. Recorded here because the citation was decorative before the amendment. |
| outcome | outcome-7 | story-7 | covered | "Cleanup decisions and failures are observable in daemon logs, including the owning feature/run and the reason an entry was retained or removed." Story 7 emits reclaimed, retained, and failed events carrying repository, slug, run, attempt, path, and reason, with the daemon log as a spine consumer. |
| story | story-1 | task-1, task-2, task-3, task-4 | covered | Resolver, required-parameter rejection, symlink and main-root pinning, ignore and exclusion assertions. |
| story | story-2 | task-5, task-6, task-7, task-8 | covered | Lease write, total reader, fail-closed acquisition, identity-only serialization. |
| story | story-3 | task-11, task-12, task-13, task-14 | covered | Both creators adopt the port, identity threading from the conductor, preserved failure semantics. |
| story | story-4 | task-9, task-10 | covered | Release with run-directory pruning; idempotent and non-throwing release. |
| story | story-5 | task-15, task-15b, task-16, task-17, task-18, task-19 | covered | Dead-owner reclamation, platform neutrality, five retention branches, per-candidate failure tolerance, daemon boundary invocation, CLI dep construction. |
| story | story-6 | task-24 | covered | Verify-only task proving the existing removal paths already reclaim scratch and preserve external run-state. |
| story | story-7 | task-20, task-21 | covered | Three event variants; unknown-identity reporting and emission-failure tolerance. |
| story | story-8 | task-22, task-23 | covered | Once-guarded legacy collection; five refusal cases for candidates that are not provably stale. |
| task | task-1 | story-1 | covered | Infrastructure task; serves Story 1's path-shape criteria directly. |
| task | task-2 | story-1 | covered | Story 1's missing-parameter negative paths. |
| task | task-3 | story-1 | covered | Story 1's symlinked-`.pipeline` and differing-main-root negative paths. |
| task | task-4 | story-1 | covered | Story 1's git-ignored and boundary-excluded criteria. |
| task | task-5 | story-2 | covered | Story 2's lease round-trip and write-before-return criteria. |
| task | task-6 | story-2 | covered | Story 2's malformed and incomplete lease negative paths. |
| task | task-7 | story-2 | covered | Story 2's lease-write-failure negative path. |
| task | task-8 | story-2 | covered | Story 2's no-credential-material criteria. |
| task | task-9 | story-4 | covered | Story 4's removal and sibling-survival criteria. |
| task | task-10 | story-4 | covered | Story 4's idempotency and removal-failure negative paths. |
| task | task-11 | story-3 | covered | Infrastructure task; Story 3's codex placement criterion and base-directory override negative path. |
| task | task-12 | story-3 | covered | Infrastructure task; Story 3's claude placement criterion and the token-liveness exclusion. |
| task | task-13 | story-3 | covered | Infrastructure task; supplies the real run id and attempt the Story 2 lease criteria depend on. |
| task | task-14 | story-3 | covered | Story 3's provisioning-failure and worktree-cleanliness negative paths. |
| task | task-15 | story-5 | covered | Story 5's dead-owner and live-owner happy paths. |
| task | task-15b | story-5 | covered | Story 5's platform-neutrality and scheduler-free criteria, added by this pass. |
| task | task-16 | story-5 | covered | Story 5's five retention negative paths. |
| task | task-17 | story-5 | covered | Story 5's failed-removal-continues negative path. |
| task | task-18 | story-5 | covered | Infrastructure task; Story 5's dispatch-boundary invocation and throw-tolerance criteria. |
| task | task-19 | story-5 | covered | Infrastructure task; makes the Task 18 dep real in production rather than test-only. |
| task | task-20 | story-7 | covered | Story 7's three-variant emission and ledger-schema criteria. |
| task | task-21 | story-7 | covered | Story 7's unknown-identity and emitter-failure negative paths. |
| task | task-22 | story-8 | covered | Story 8's collection and once-only criteria. |
| task | task-23 | story-8 | covered | Story 8's five refusal negative paths. |
| task | task-24 | story-6 | covered | Verify-only; Story 6's removal-reclaims-scratch and run-state-survives criteria. |

## Consistency pass (§4d)

Every `covered` row above was re-read for contradiction. Cross-layer pairs were checked in both directions; same-layer story-vs-story pairs belong to `/conflict-check` and are not re-reported here.

Two cross-layer pairs were worth checking closely, and both hold:

- **outcome-1 (nothing left behind) against outcome-2 (orphans reclaimed later).** If outcome-1 is fully satisfied for a normally completed attempt, outcome-2 still holds — it governs a disjoint case, abrupt termination. If outcome-2 is fully satisfied, outcome-1 still holds — the sweep is additive to teardown and never replaces it. No oscillation.
- **outcome-2 (remove orphans) against outcome-4 (preserve durable run-state).** If outcome-2 is fully satisfied, outcome-4 still holds, because reclamation is scoped to the scratch root and never reaches run-state. If outcome-4 is fully satisfied, outcome-2 still holds, because run-state preservation places no constraint on scratch. The two were only ever in tension under the rejected placement that put scratch inside the run-state store; the chosen `.daemon/` placement removes the tension by construction. No oscillation.

One contradiction was found and resolved during this pass rather than recorded as `fail`, because the amendment landed in the same DECIDE pass: the intake's outcome-6 was cited by Story 5 while none of Story 5's acceptance criteria addressed platform neutrality or the absence of a scheduler. Crediting that citation would have been exactly the decorative-citation case §4e warns about. Story 5 was amended additively with two happy-path criteria and one Done-When item, and plan Task 15b was added to implement them. The row is now genuinely covered.

Zero `gap` rows. Zero `fail` rows.
