# Intake origin: root-vitest-run-temp-state-on-a-disk-backed-parent

Source-Ref: jstoup111/ai-conductor#2224
Owner: jstoup111

## Desired outcome
Root the suite's temp state on disk rather than in RAM, and stop inheriting whatever `/tmp` happens to be:

- Default the run root's parent to a disk-backed, repo- or user-scoped location (e.g. under the repo's ignored build dir, or `$XDG_CACHE_HOME/ai-conductor`), falling back to `os.tmpdir()` only when that is unavailable.
- Make it overridable by an explicit env var so CI can point it wherever it wants.
- Keep the existing `TMPDIR` redirect and teardown behavior unchanged — this changes only the parent directory the run root is created in.
