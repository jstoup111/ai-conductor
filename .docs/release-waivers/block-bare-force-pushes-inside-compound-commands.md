Waives: hook wiring

Rationale: The release-gate classifier flags this PR under "hook wiring" because it maps any
change under `hooks/` to that surface. This diff is a 9-line content-only edit inside the
already-wired `hooks/claude/block-destructive-git.sh` (tightening bare `--force`/`-f` detection
across unquoted compound commands and preventing a lease flag from masking a later bare force
flag). No hook is added, removed, renamed, or re-registered; `settings.json` hook wiring is
untouched; consumers receive the stricter check through the ordinary installed checkout with no
action to run, so there is no runnable migration to author. Precedent:
`.docs/release-waivers/2026-07-12-rtk-hook-preservation.md` waived the same
classifier-by-path quirk for `skill symlink targets`.
