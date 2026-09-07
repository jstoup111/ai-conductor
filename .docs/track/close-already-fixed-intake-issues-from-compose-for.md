# Track: Close already-fixed intake issues from compose forget

Track: technical

Scope boundary: Small fix for #830, approved by the operator on 2026-09-06 (delegated). Wire the
existing terminal abandon verb `compose forget` so an operator-approved "already fixed" drop
comments the resolving reference on the originating GitHub issue and closes it, leaving the intake
ledger and the issue in agreement. A drop for any other reason keeps today's behavior exactly. Out
of scope: a new CLI verb, a new ledger status, automatic detection of "already fixed", closing
issues from any non-terminal step, and any change to the spec-authored write-back path
(`land`/`handoff` and the intake write-back module).

This is internal tooling for the intake loop; acceptance criteria live in technical stories rather
than a PRD.

The filer's first hypothesis — a new `engineer resolve --source-ref --resolved-by` verb — was
weighed and rejected: `compose forget` is already the loop's declared terminal abandon step
("terminal step — claim → worktree → land → handoff → resolve/forget (abandon path)"), it already
parses the source ref, already writes to the originating issue (the label strip), and already drops
the ledger entry. A second verb would duplicate all four and split the abandon path in two. The
alternative not derived from the filer's sketch — closing from the `claim`/DECIDE side — was
rejected because DECIDE has no deterministic primitive of its own and the close must be the last
act, after the ledger drop is agreed. Adding one optional flag to the existing terminal verb is the
smallest change that satisfies every desired outcome. Approved by the operator on 2026-09-06
(delegated).

Scope check: A — consumer-facing (no repo-only signal fires: the change touches neither self-host,
daemon, sandbox, release-gate, this repository's CI, nor a convention only this repository has; a
repository that installs the harness and runs `ai-conductor compose` against its own GitHub issues
benefits identically). B — n/a (no new skill; `skills/composer/SKILL.md` is an existing shipped
skill). C — provider-agnostic: the flag, the CLI behavior, and the composer instruction are host
independent, and the one host-specific sentence in the composer loop keeps the existing paired
`/composer` and `$composer` mechanics untouched. No catalog registration is required. No
`HARNESS.md` rule changes; the behavior lives in the shipped skill and the CLI.

Event spine: no new event, metric, span, log line, or report. The verb's existing single JSON result
line gains fields, and failures use the verb's existing stderr diagnostic path.

Verified foundation: `engineer-cli.ts` parses `forget` at its subcommand grammar with an empty
allow-list (`findUnknownFlag(argv, [])`) and dispatches a case that reads the ledger entry, calls
`ledger.forget`, then best-effort strips `engineer:handled` via `restRemoveLabelArgs` using
`parseSourceRef`. `tracker-client.ts` already exposes `upsertIssueComment` and `closeIssue` over the
same injected `GhRunner` shape that `DispatchEngineerOpts.gh` supplies, so the comment and close
need no new adapter. `writeback.ts` exposes only `reportRouted`/`reportDone` and is reached solely
from the spec-authored `land`/`handoff` path, so it cannot serve a drop that authors no spec;
`closeIssueOnImplementationMerge` in `issue-ref.ts` only injects a `Closes` line into an
implementation PR body, which an already-fixed idea never produces. Both confirm the defect is
still live on origin/main.
