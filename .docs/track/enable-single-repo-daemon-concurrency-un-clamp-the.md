# Track: enable-single-repo-daemon-concurrency-un-clamp-the

Track: technical

Scope boundary: Balanced (operator-confirmed 2026-08-27). Extract a dispatcher/executor seam
inside the single daemon process designed for a central-dispatcher future (topology B): the
dispatch contract is a serializable work order carrying a document manifest (spec/plan artifact
refs + hashes, git-resolvable today but not git-required by contract); the dispatcher side owns
backlog scan, root-checkout operations (fast-forward, engine rebuild, sweeps), a work-claim
interface (in-memory implementation only), and an interleaving-correct self-host live boundary;
the executor owns exactly one feature build in its own workspace and never touches the root
checkout or `.daemon/`. Then un-clamp N executors behind an explicit config key (default 1;
at 1, behavior is byte-for-byte today's serial daemon). In scope: idle-gate starvation fixes,
slug-attributable logs, N>1 isolation tests, shared-`.daemon/` safety. Out of scope: multi-process
or remote executors, durable/distributed claims, transport, #564's cwd-ambiguity relocation work,
per-feature attachable tmux sessions.

Daemon infrastructure refactor plus an operator config flag — no end-user product behavior;
acceptance criteria live in stories (no PRD).
