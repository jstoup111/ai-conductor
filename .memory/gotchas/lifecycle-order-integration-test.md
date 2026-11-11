---
created: 2026-11-07
category: gotchas
related: [lifecycle ordering, integration tests, collaborator calls, failure boundaries]
---

## Lifecycle-order tests must observe calls and the failure boundary

An integration test for lifecycle ordering must directly observe collaborators called in order and prove the downstream collaborator is not called when an earlier one fails. A downstream marker or final state alone does not prove sequencing.

### Why

Final state can be correct even when collaborators ran in the wrong order or a downstream action ran before an earlier failure. Call-order observation and the non-call boundary prove the lifecycle contract itself.

### Applies When

Adding or changing a multi-step lifecycle integration test with ordered collaborators or an early-failure boundary.
