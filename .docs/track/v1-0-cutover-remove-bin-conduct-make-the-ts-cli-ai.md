# Track: v1.0 cutover — remove bin/conduct, make the TS CLI (ai-conductor) the only CLI

Track: technical

Scope boundary: Symlink swap (`~/.local/bin/conduct` → `bin/ai-conductor`, deprecation-window alias like conduct-ts), delete `bin/conduct` + its dedicated tests, sweep forward-facing docs/references, extend the legacy-reference guard to police `bin/conduct` mentions. Deliberately dropped flags: `--auto`, `--step`, `--log`, `--output` (plus bash-state-bound `--cooldown` semantics live on in TS's own implementation). Excluded: internal/behind-the-scenes naming cleanup (separate intake, rolls into the large rename issue) and alias retirement (separate post-merge intake). No VERSION/CHANGELOG edits — Release-Semver: major declared in PR body.

Rationale: CLI/installer removal work with no new user-facing capability; parity is already implemented in the TS CLI (verified 2026-08-29), so straight removal (Approach B) plus a reference guard suffices.
