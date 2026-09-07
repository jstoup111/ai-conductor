# Intake origin: resolve-the-decide-grant-store-from-the-repository

Source-Ref: jstoup111/ai-conductor#1621
Owner: jstoup111

## Desired outcome
- A grant recorded by `decide-grant` is honored by the engine regardless of the cwd the command was invoked from within the repository (root, worktree, or any subdirectory).
- Running it outside any conductor repository fails loudly instead of writing an orphan file.
- The success message names the absolute store path it wrote, so a misplaced write is visible immediately.
