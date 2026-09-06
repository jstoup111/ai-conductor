# Complexity: Cover nested bin shell files in both lint gates

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one enumeration function in `test/lint_shell.sh`, the syntax-check section of `test/test_harness_integrity.sh` that duplicates it, and one new focused fixture suite for the enumerator. It introduces no new gate, no new numbered integrity check, no CI job, no configuration key, no event, metric, span, or log line, and no consumer-visible surface: `bin/conduct`/`ai-conductor` CLI, `settings.json` schema, hook wiring, and skill symlink targets are untouched, so no migration block is owed. The newly covered file already passes both gates, so no script under the widened surface changes. Small-tier architecture, conflict-check, and coherence artifacts are not required.
