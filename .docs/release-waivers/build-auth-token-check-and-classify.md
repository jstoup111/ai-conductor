Waives: skill symlink targets

Rationale: The diff to `bin/install` (commit dfcd486e) adds a purely additive,
read-only diagnostic line inside `check_installation` that delegates to
`conduct-ts build-auth-status` and formats an ok/fail line from its exit code
(mirroring the existing conduct-ts-absent warning pattern). It does not touch
the file's symlink-creation/update logic (the `ln -sfn` blocks for skills,
`conduct`, and `conduct-ts`), does not change any existing symlink target
path, and does not alter install/update/uninstall behavior for skills or the
conduct/conduct-ts symlinks. Verified via `git show dfcd486e -- bin/install`
and `grep -n "ln -sfn" bin/install`: the full diff is exactly the new
diagnostic block, nowhere near the symlink logic.
