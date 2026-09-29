# Intake origin: exempt-vitest-temp-dir-from-tmpdir-leak-guard

Source-Ref: jstoup111/ai-conductor#2759
Owner: jstoup111

## Desired outcome
- A targeted test run launched with bare `npx vitest run <file>` does not report Vitest's own temp dir as a leak.
- A genuine stray `/tmp` entry created by a test still fails teardown.
- The documented targeted-run command works in a feature worktree without PATH tweaks.
