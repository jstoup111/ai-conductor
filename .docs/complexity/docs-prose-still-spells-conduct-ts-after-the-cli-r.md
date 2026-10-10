# Complexity: Legacy-CLI guard covers all of docs/ (#2028)

Tier: S

Rationale: two shell test files (`test/test_no_legacy_cli_references.sh` and its backend regression `test/test_legacy_cli_guard_backends.sh`). The change widens one scanned path set and adds two exact allowlist entries. No data models, no external integrations, no auth, no state machines, no engine code; expected story count 1. Per tier rules: architecture-diagram, architecture-review, conflict-check, and coherence-check are skipped.
