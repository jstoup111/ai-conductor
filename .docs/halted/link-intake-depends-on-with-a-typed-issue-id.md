# Halt record

Status: halted
Slug: link-intake-depends-on-with-a-typed-issue-id
Class: needs-human
Halting step: architecture_review_as_built
Phase: SHIP
Branch: feat/daemon-link-intake-depends-on-with-a-typed-issue-id
Head SHA: b3f522f24e3d11b6d3e528316a6c15000fa8c997
Halted at: 2026-09-29T16:10:48.706Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "architecture_review_as_built" halted: needs human DECIDE — unreachable-tracker-add-dependency (architectural-clarity: createGithubTrackerClient.addIssueDependency (src/conductor/src/engine/tracker-client.ts:967) has no production caller, which the approved plan's claim ledger already verified ('its only callers are tests') before sealing Task 2 to fix it anyway; Task 2's Files admit only tracker-client.ts and two tests and its Done-when items are all met, so no task admits wiring a caller (existing-task/build would be unauthorized). The only production dependency-add paths are createIntakeFilingOperations (file-issue.ts:194/366, its own guarded ownership wrapper and id read) and createDependencyLinks (issue-dep-migration.ts:364, intake.issue.dependency.add under intake-write access); rerouting either through addIssueDependency changes operation/access semantics, and deleting the method instead would regress Task 2 / Story 2 coverage. A human must choose: accept the test-only primitive as a waived reachability finding, amend the plan to reroute a named production path, or amend it to remove the method (confidence 85% that this is a decision, not a determinable code fix).)
```
