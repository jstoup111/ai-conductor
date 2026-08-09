---
created: 2026-08-09
category: gotchas
related: [pipeline, test configuration, update-check-config-single-source-of-truth]
---

## Scoped test runner is not configured

`conduct-ts scoped-run` currently exits with `scoped-run: unavailable; configure test_suite.scoped_command.`

### Why

Pipeline tasks must use a direct, narrow test-file fallback until the repository config supplies the scoped verifier command.

### Applies When

Running BUILD task verification in this repository.
