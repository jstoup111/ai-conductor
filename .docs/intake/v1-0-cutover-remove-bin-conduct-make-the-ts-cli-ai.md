# Intake origin: v1-0-cutover-remove-bin-conduct-make-the-ts-cli-ai

Source-Ref: jstoup111/ai-conductor#226
Owner: jstoup111

## Desired outcome

- The TS CLI is the only CLI: `~/.local/bin/conduct` resolves to the canonical TS launcher and the legacy bash implementation is gone.
- Node >= 20.5 and a successful engine build are hard install requirements; install cannot succeed without a working TS engine.
- The legacy bash CLI's dedicated test scripts are removed with their still-relevant coverage preserved in the surviving suites.
- Operators on existing installs converge by re-running the installer: the stale `conduct` symlink is replaced idempotently and a failed engine build fails the install loudly.
- Documentation and harness references reflect the single-CLI reality.

(Derived 2026-08-29 from the issue's "## Scope (single PR)" section; the issue predates the
intake template and carries no verbatim Desired outcome section. Naming updated per PR #2023:
the surviving binary is bin/ai-conductor.)
