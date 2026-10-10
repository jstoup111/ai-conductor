# Track: Dead src/conductor/bin/ directory lingers after intake-file moves into the skill (#2791)

Track: technical

Change class: deletion

Scope boundary: Removal half only. Delete the `src/conductor/bin/` directory (its sole file is the stale, type-broken `src/conductor/bin/intake-file`) and nothing else. The mechanical reference cleanup already shipped with #742 (`.docs/shipped/skills-may-bundle-executable-helpers.md`): on local main `e6b56fe3da`, `git grep "src/conductor/bin"` outside `.docs/` returns only the file's own contents, so per CLAUDE.md "Skill Deletions Ship as Two Features" this spec is the Removal feature alone. Excluded: any edit to the bundled helper `skills/intake/scripts/intake-file`, `intake-file-cli.ts`, `file-issue.ts`, tsconfig, or contributor docs; and any edit to historical `.docs/` decision records (`adr-2026-09-28-skills-may-bundle-executable-helpers.md`, `architecture-review-2026-09-28-skills-may-bundle-executable-helpers.md`) that mention the path as history — they are other features' sealed artifacts and their mention describes the follow-up this spec delivers.

Deleting an unreferenced, type-broken file with no runtime caller changes no product behavior; no PRD is warranted.
