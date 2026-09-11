# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-09-09T17:33:42.401Z
Slug: seed-the-live-daemon-e2e-smoke-as-a-linked-worktre
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-seed-the-live-daemon-e2e-smoke-as-a-linked-worktre
Head SHA: 8a34a6b173610a5ead8451f5c4ee261131186432
Halted at: 2026-09-09T16:02:48.981Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.
Current lap lap-8a34a6b173610a5ead8451f5c4ee261131186432: testQuality closed cause malformed-artifact (invalid-provider-result: judged-result contract not satisfied after one repair turn: findings[0].anchor.locus must reference a projected in-scope content region (path, contentHash, and occurrence must match one). Raw output excerpt: {"findings":[{"concernKind":"test-insensitive","summary":"The seeding test's `fixtureRemoved: true` assertion is computed after the test's own `rm(fixtureRoot, {recursive:true, force:true})` in its `finally` block, so it is unconditionally true and cannot distinguish the run body's changed teardown (`if (fixtureRoot) await rm(...)` replacing the worktree-only removal at src/conductor/test/fixtures/live-e2e-run-body.ts:532). Stubbing or reverting that teardown to remove only the worktree directory leaves this assertion passing. Either drop the `fixtureRemoved` key, since it asserts only that the test cleaned up after itself, or exercise the run body's teardown path and assert the seeded main checkout and its linked worktree no longer exist.","evidenceLocations":["src/conduct
[...truncated 2096 bytes...]
ed worktree that resolves its production build-review identity and effective verdict"},"obligationReferences":["task:1"],"associationReason":"The region calls the new exported `seedLiveE2EFixture` and asserts the production `resolveBuildReviewFeatureIdentity` returns the seeded main checkout as repository with the fixture slug as feature, that the production `resolveEffectiveBuildReviewVerdict` resolves ok against the seeded project root with no disposition state file on disk, that the project root is `<main>/.worktrees/<slug>`, and that the seed commit is an ancestor of `feature/<slug>` — matching task:1's Done-when checks 1 through 3. The candidate's other supplied obligations (task:2 occupied-path rejection, task:4 unparked terminal success, task:5 parked denial) are asserted by separate sibling regions in the same file at lines 85-123, 125-142, and 144-166 respectively, not by this region, so only task:1 is applicable here."}],"counterfactualSensitivity":"not-applicable"}).
1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-8a34a6b173610a5ead8451f5c4ee261131186432 --rubric testQuality --rationale "<rationale>".
2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.
```
