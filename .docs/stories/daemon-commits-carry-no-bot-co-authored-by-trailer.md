**Status:** Accepted

# Stories: Daemon commits carry the bot co-author trailer under every executor isolation mode

Technical track (no PRD). Source: jstoup111/ai-conductor#3377. Governing decision:
adr-2026-09-11-github-operation-ownership D10, as amended 2026-10-24. Architecture review:
`.docs/decisions/architecture-review-2026-10-24-daemon-commits-carry-no-bot-co-authored-by-trailer.md`.
Scope boundary: `.docs/track/daemon-commits-carry-no-bot-co-authored-by-trailer.md` (Balanced).

Trailer format, hook stamping, engine-commit stamping, idempotence, and token confinement are
specified by `.docs/stories/daemon-commits-co-authored-by-the-configured-bot.md` and are unchanged
here. These stories cover only which daemon processes can produce the trailer, and what happens
when one cannot.

## Story 1: Child-isolated daemon dispatches produce the bot trailer

**Requirement:** #3377 desired outcome 1 (default `executor_isolation: child`)

As the operator, I want daemon builds under the default child isolation to credit the configured bot as a co-author, so GitHub shows the operator and bot pairing that #2722 promised.

### Acceptance Criteria

#### Happy Path
- Given `executor_isolation: child` and a configured bot whose identity resolves to login `example-bot` and id `42`, when the daemon dispatches a feature, then the dispatched worktree's `.pipeline/co-author` contains exactly `Co-authored-by: example-bot <42+example-bot@users.noreply.github.com>` before the first build step runs.
- Given that dispatch, when a build agent commits in the feature worktree, then the commit message carries that trailer exactly once and the commit author is the operator's git identity.
- Given that dispatch, when the executor child makes an engine bookkeeping commit through the shared commit helper (for example a halt record), then that commit message carries the same trailer exactly once.

#### Negative Paths
- Given `executor_isolation: child` and a configured bot whose token file is unreadable, when the daemon dispatches a feature, then no `.pipeline/co-author` file exists in the worktree, setup continues, and one `bot_co_author_skipped` event with reason `token-unavailable` appears in that worktree's `.pipeline/events.jsonl` and as a rendered line in `.daemon/daemon.log`.
- Given `executor_isolation: child` and a configured bot whose identity read fails, when the daemon dispatches a feature, then the build agent's commits carry no bot trailer and one `bot_co_author_skipped` event with reason `identity-read-failed` reaches the worktree spine and `.daemon/daemon.log`.
- Given `executor_isolation: child` and a configured bot whose identity read fails, when the executor child makes an engine bookkeeping commit, then that commit succeeds and its message is byte-identical to the message without the helper.

### Done When
- [ ] A test that drives the executor-child entry composition, rather than calling the resolver directly with an injected instance, observes the resolved trailer in the child-prepared worktree's `.pipeline/co-author`.
- [ ] A test observes a child-made engine commit carrying the trailer once.
- [ ] A test observes a child-side skip event persisted to the worktree `events.jsonl` and forwarded to the supervisor's event bus with its closed reason.

## Story 2: In-process daemon dispatches keep producing the bot trailer, and operator entry points never do

**Requirement:** #3377 desired outcomes 2 and 5

As the operator, I want both executor isolation modes to set up attribution the same way, and operator-run commands never to, so switching modes cannot silently drop the trailer and my own commits stay mine.

### Acceptance Criteria

#### Happy Path
- Given `executor_isolation: in-process` and a configured bot whose identity resolves, when the daemon dispatches a feature, then the worktree's `.pipeline/co-author` contains the resolved trailer and build-agent commits carry it exactly once.
- Given the daemon entry point and the executor-child entry point, when the wiring test inspects production source, then each calls the shared daemon-process bootstrap exactly once before any feature dispatch work, and the resolver is installed nowhere else.
- Given an operator-run CLI that prepares or commits in a worktree, when it runs, then it installs no resolver and its commits carry no bot trailer.

#### Negative Paths
- Given `executor_isolation: in-process` and a configured bot whose token file is unreadable, when the daemon dispatches a feature, then no co-author file is written and one `bot_co_author_skipped` event with reason `token-unavailable` reaches the feature spine and `.daemon/daemon.log`.
- Given a production source change that adds a resolver install outside the shared bootstrap, or removes the bootstrap call from either daemon entry point, when the wiring test runs, then it fails and names the offending or missing entry point.
- Given a configured bot and an operator running a manual `git commit` in their root checkout, when the commit is recorded, then its message carries no bot trailer and no `bot_co_author_skipped` event is emitted.

### Done When
- [ ] A test observes the trailer in an in-process dispatch's worktree co-author file.
- [ ] The wiring test pins both daemon entry points to the shared bootstrap and fails on a bootstrap-free install or a missing call.
- [ ] A test observes that an operator-run preparation without daemon dispatch writes no co-author file and emits no event.

## Story 3: A daemon dispatch with no resolver installed says so instead of failing silently

**Requirement:** #3377 desired outcomes 3 and 4

As the operator, I want a missing co-author resolver during daemon dispatch to produce a visible skip event, so attribution can never fail silently for weeks again, without new noise when no bot is configured.

### Acceptance Criteria

#### Happy Path
- Given a daemon dispatch whose process has no resolver installed, when the worktree is prepared for dispatch, then no `.pipeline/co-author` file exists, setup continues to the first build step, and one `bot_co_author_skipped` event with reason `resolver-absent` is emitted on that feature's spine.
- Given that event, when the supervisor renders it, then `.daemon/daemon.log` carries one line naming the skip as caused by an absent resolver, and the event payload contains only its type and closed reason.
- Given `github_bot` is not configured and the resolver is installed, when the daemon dispatches a feature under either isolation mode, then no co-author file is written, commits carry no bot trailer, and no `bot_co_author_skipped` event is emitted.

#### Negative Paths
- Given an operator-run worktree preparation that is not a daemon dispatch and has no resolver installed, when it runs, then it emits no `bot_co_author_skipped` event and writes no co-author file.
- Given a daemon dispatch with no resolver installed, when the event emitter rejects the skip event, then worktree setup still completes and the stale co-author file is still absent.
- Given a daemon dispatch with no resolver installed, when the engine later makes a bookkeeping commit in that process, then the commit succeeds without a trailer and no additional skip event is emitted for that commit.
- Given a stale `.pipeline/co-author` file left by an earlier dispatch, when a dispatch with no resolver installed prepares the worktree, then the stale file is removed and no trailer from it reaches any new commit.

### Done When
- [ ] The closed `bot_co_author_skipped` reason set includes `resolver-absent`, and its `daemon.log` rendering is covered by an exhaustive formatter test.
- [ ] A test observes `resolver-absent` on a dispatch-time preparation with no resolver and no event on a non-dispatch preparation.
- [ ] A test observes no event and no co-author file under either isolation mode when `github_bot` is unconfigured.
