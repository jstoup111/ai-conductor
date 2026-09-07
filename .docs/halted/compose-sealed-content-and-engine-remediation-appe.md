# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-07T11:34:31.328Z
Slug: compose-sealed-content-and-engine-remediation-appe
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-compose-sealed-content-and-engine-remediation-appe
Head SHA: b297fd9b865644b923947a6d297cc68618a6c7bd
Halted at: 2026-09-07T04:44:46.663Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-1 (existing-task: AB-1 is implementation conformance drift admitted by an existing active-plan task, not a planning or architectural gap (confidence: high, grounded in the cited lines read directly in this worktree). Evidence: src/conductor/src/engine/protected-artifact-seal.ts:680-690 returns 'baseline-unresolvable' straight from the ancestry probe, so the degrading sealed-content read at src/conductor/src/engine/protected-artifact-seal.ts:708 is unreachable for an unreadable baseline commit, and src/conductor/test/engine/protected-artifact-seal.test.ts:1299-1316 asserts that contradictory early result. Active-plan task 2 ('Supply the verified sealed baseline from the repository') already admits the remedy in its Done when 2 -- 'Through the same entry point with an unresolvable seal baseline commit, the evaluation completes without throwing and returns the verdict the base-tip anchor alone produces' -- so task 2 is re-staged and no task is appended; tasks 1, 3 and 4 were examined and none of them touches the in-repository entry point's unresolvable-baseline exit. The remedy is: in evaluateProtectedArtifactSealRotationInRepository, when the ancestry probe cannot resolve because the seal's baseline commit is unreadable, supply no sealed-baseline map and continue into the existing base-tip-only evaluation instead of returning early, and rewrite the test case at src/conductor/test/engine/protected-artifact-seal.test.ts:1299-1316 to assert that base-tip-only verdict in the SAME change. Regression control: that test case pre-dates this branch, so its replacement is licensed only by task 2's Done when 2 and the sealed Story 1 negative criterion at line 25 of the feature's stories artifact; the 'baseline-unresolvable' behaviour it covered must survive rather than be deleted -- retain the condition for a probe failure whose baseline commit IS readable, keeping the pure-evaluator guard at src/conductor/src/engine/protected-artifact-seal.ts:398-400 (asserted at src/conductor/test/engine/protected-artifact-seal.test.ts:817 and 843) and the refusal reason at src/conductor/src/engine/protected-artifact-seal.ts:1130-1134 reachable. Matched-pair and orphan sweep for the same shape: src/conductor/src/engine/protected-artifact-seal.ts:399 (pure evaluator guard), :1130-1134 (refusal reason text), src/conductor/src/types/events.ts:584 (condition union member), and src/conductor/test/engine/protected-artifact-seal.test.ts:817/843 -- all four are counterparts of the same 'baseline-unresolvable' vocabulary and are named here to be kept in agreement by the one change; none is removed and no sibling site was found that plan task 2 does not admit.) — remediation produced no dispatchable build work; the implicated task(s) are already evidence-complete — human needed
```
