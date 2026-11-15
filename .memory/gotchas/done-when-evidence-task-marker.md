---
created: 2026-11-07
category: gotchas
related: [pipeline task closure, Done-when evidence, test coverage markers]
---

## Done-when test evidence needs an exact title and task marker

When a new or changed test is intended as Done-when evidence, add `// Covers: task:<id>` and cite the test by its exact declared title. Do not infer or paraphrase its title in the citation.

### Why

The pipeline verifies that task-closing test evidence is explicitly attributable to its owning task; passing tests without that marker do not establish closure. Evidence review also needs the literal test title to match the cited test unambiguously; an inferred paraphrase cannot be verified reliably.

### Applies When

Adding or changing a test that a pipeline task cites as Done-when evidence, or reporting that evidence for task closure.
