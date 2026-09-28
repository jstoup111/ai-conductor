# Track: make-bin-install-uninstall-remove-installer-settin

Track: technical

Scope boundary: minimal. `bin/install --uninstall` removes the Claude Code hook entries whose command lives under this checkout's `hooks/claude/` directory and the permission entries that exactly match the installer's `HARNESS_PERMISSIONS` list from `~/.claude/settings.json`, pruning event arrays it empties and leaving every other setting intact; removes the harness-owned `~/.ai-conductor/rate-card.json` link; preserves the rest of `~/.ai-conductor/` and reports what it kept and why; adds a `--purge` flag that also deletes `~/.ai-conductor/`; updates the quickstart uninstall limitation note to match; and adds an install-then-uninstall round-trip test. Excluded: hooks pointing at a prior harness checkout, the legacy `~/.claude/ai-conductor.config.json` files, optional viewer/renderer tools and brew packages, and any install-time manifest.

Installer tooling fix (issue #1004) with no product requirement; acceptance criteria live in stories. → **technical track** (skip `/prd`).
