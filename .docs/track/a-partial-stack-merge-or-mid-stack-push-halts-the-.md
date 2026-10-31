# Track: Stack teardown keeps merged child branches whose GitHub head moved

Track: technical

Scope boundary: The fix is in stack teardown only, and fixes forward. A merged child's local branch, and its engine refs, are deleted under an accounted-for proof: every local commit is reachable from the recorded pushed tip or from the merged PR head, or else is a halt-record-only commit. Out of scope: cleaning up branches that leaked before this fix (an operator does that by hand), `stack adopt`, accepting a server-side rebase in FINISH or in the tip guard, and refreshing a published stack. #3268 keeps those, deferred until #3269 or #3270 adds a post-publication write path.

Engine bookkeeping with no user-facing behavior. All 3 stacks shipped so far kept every child branch, because the current deletion proof requires the local tip to equal GitHub's `headRefOid`.
