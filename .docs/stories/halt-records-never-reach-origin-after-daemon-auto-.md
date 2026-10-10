**Status:** Accepted

# Stories: Halt records never reach origin after daemon auto-rebase

Source: jstoup111/ai-conductor#2891. Track: technical (no PRD). Tier: S.

After the daemon's rebase gate rewrites a feature branch locally, origin still holds the
pre-rebase tip, so every plain halt-record push is rejected non-fast-forward and the record stays
local until SHIP. These stories make the halt record and its resolution reach origin after the
daemon's own rewrite, while a remote moved by anyone else is never overwritten and the failure is
still reported. "Remote unmoved" below means origin's branch tip still equals the tip the daemon
last pushed, which is what the branch's remote-tracking ref records.

## Story 1: A halt record written after a daemon rebase reaches origin

**Requirement:** #2891 desired outcomes 1 and 3

As an operator reading origin or GitHub, I want the halt record for a rebased feature to appear on
its remote branch, so that I see current halt state without logging in to the daemon host.

### Acceptance Criteria

#### Happy Path
- Given a feature branch whose already-pushed history was rewritten locally after its last push and whose remote branch is unmoved, when an operator-actionable halt is raised through the halt-marker seam, then origin's branch tip equals the worktree's local HEAD, that tip contains the halt record with `Status: halted`, a `halt_record_written` event names the record path, and no `halt_record_push_failed` event is emitted.
- Given the same rewritten branch with the engine-provisioned `pre-push` guard installed in the repository, when the halt record is published, then the guard admits the push and origin's branch tip equals the worktree's local HEAD.

#### Negative Paths
- Given a rewritten feature branch whose remote branch was advanced by another clone after the daemon's last push, when an operator-actionable halt is raised through the halt-marker seam, then the engine refuses the push before pushing, origin's branch tip is still the other clone's commit, the halt record commit remains on the local branch, the HALT marker is still written, the halt path neither fails nor throws, a `push_lease_refused` event names the ref with the expected and actual SHAs, and a `halt_record_push_failed` event names the record path with the lease refusal as its reason.
- Given any halt-record publication, when the push command is issued, then it follows a fetch of that one branch, carries `--force-with-lease=refs/heads/<branch>:<expected-sha>`, and carries no bare `--force-with-lease` and no bare force (`--force`, `-f`, or a `+`-prefixed refspec).

### Done When
- [ ] A real-git test against a local bare remote shows origin's branch tip equal to the rewritten local HEAD after a halt, with the record at that tip and no `halt_record_push_failed` event.
- [ ] A real-git test shows a remote advanced by another clone keeps its tip, the local record commit survives, `push_lease_refused` is persisted, and `halt_record_push_failed` carries the lease refusal as its reason.
- [ ] After a single-branch fetch, the halt-record push argument vector is `push origin HEAD:refs/heads/<branch> --force-with-lease=refs/heads/<branch>:<expected-sha>`.

## Story 2: A halt resolution written after a daemon rebase reaches origin

**Requirement:** #2891 desired outcomes 2 and 3

As an operator, I want the "halt resolved" update of a rebased feature to reach origin, so that
origin never shows a halt that has already been cleared.

### Acceptance Criteria

#### Happy Path
- Given a feature branch carrying a committed halt record with `Status: halted`, rewritten locally after its last push, with its remote branch unmoved, when the halt record is superseded, then the supersede result is `written`, origin's branch tip equals the worktree's local HEAD, and the record at that tip reads `Status: resolved` with the resolution cause.

#### Negative Paths
- Given the same rewritten branch whose remote branch was advanced by another clone after the daemon's last push, when the halt record is superseded, then the engine refuses the push before pushing, `push_lease_refused` is persisted, the result is `pushFailed` with the lease refusal as its reason, origin's branch tip is still the other clone's commit, and the local branch keeps the resolved-record commit.

### Done When
- [ ] A real-git test shows a superseded record on a rewritten branch reaches origin with `Status: resolved`.
- [ ] A real-git test shows a supersede against a remote advanced by another clone returns `pushFailed` with the lease refusal as its reason and leaves origin's tip unchanged.
