# Track: Daemon build agents leak edits into the MAIN checkout (worktree isolation escape)

Track: technical

Daemon-internal robustness (leak detection/auto-heal on the FF-skip path + a write-fence
for build sessions). No user-facing product behavior — acceptance criteria live in stories.
Source: jstoup111/ai-conductor#380.
