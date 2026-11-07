---
created: 2026-11-07
category: gotchas
related: [pipeline task closure, Done-when evidence, test coverage markers]
---

## Done-when test evidence needs a task marker

When a new or changed test is intended as Done-when evidence, add `// Covers: task:<id>` to the test or task closure will be refused.

### Why

The pipeline verifies that task-closing test evidence is explicitly attributable to its owning task; passing tests without that marker do not establish closure.

### Applies When

Adding or changing a test that a pipeline task cites as Done-when evidence.
