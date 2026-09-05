# Track: Rebase diff hunk header isolation

Track: technical

Source-Ref: jstoup111/ai-conductor#2180

Scope boundary: Correct dropped-commit verification for source lines beginning with -- or ++, preserving their content and original file paths, and prevent the reported deletion-only verification bypass. Preserve existing supersession policy, Git command protocol, line-count comparison and legitimate whole-file deletion handling. No general diff-library replacement, provider change, rebase-policy redesign or implementation in this spec PR. The operator authorized complete unambiguous S specs, including issues whose initial label is M, on 2026-09-05.

Approach: distinguish file-header state from hunk-content state in the existing private parser (S, approximately one hour; restores correct input to the current guard). Alternative: derive paths from structured Git metadata in a separate query (S/M, roughly half day; adds command/association failure cases while still needing hunk content parsing). A new general diff parser/library (M, half day) adds dependency and compatibility work beyond this defect. The local state change directly addresses the reproduced failure without a new policy decision.

Scope check: A — consumer-facing engine correctness, because the rebase guard runs for installed consumer projects as well as this repository; no HARNESS behavioral rule change. B — n/a, no skill. C — provider agnostic: existing GitRunner boundary only. Registration: no new commands, config, event variants or skills.

Verified: parseDroppedCommitDiff currently recognizes --- and +++ before content prefixes, ignores @@ without retaining hunk state, and supplies paths/line counts to supersededByBase. Executing public featureCommitsPreserved against a faithful fake Git transcript returned true for a skipped replacement containing an added ++ source line, after querying a corrupted HEAD path. A removed -- comment disappeared from the removed-line set entirely. No pending load-bearing assumptions; claim verdict CLEAR.
