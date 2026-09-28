# Intake origin: make-bin-install-uninstall-remove-installer-settin

Source-Ref: jstoup111/ai-conductor#1004
Owner: jstoup111

## Desired outcome

- `--uninstall` removes every artifact the installer created, or explicitly reports what it is leaving and why.
- Hooks and permissions the installer added to `~/.claude/settings.json` are removed without disturbing unrelated user settings.
- Running install then uninstall returns the relevant paths to their pre-install state.
- A test covers the install → uninstall round trip.
