# Track: Reap unattributable leaked cc-daemon tmux sessions and orphaned dispatch processes

Track: technical

Scope boundary: Balanced (operator-confirmed). In scope: (1) the daemon terminates each provider dispatch's full descendant process tree on every exit path it controls (normal end, timeout/abort, SIGHUP/SIGTERM — which covers `daemon restart`'s `respawn-pane -k` and `daemon stop`); (2) a read-only `daemon status` surface reporting unattributable `cc-daemon-*` tmux sessions and orphaned processes under registered repos' `.worktrees/*`. Excluded: autonomous reaping of anything the daemon did not spawn (no janitor kill path), PID-namespace containment for non-self-host dispatches, test-side tmux socket isolation (#2476, in flight), and the test kill-switch session guard (#257, shipped).

Internal daemon process hygiene with no product requirements; acceptance criteria live in stories.
