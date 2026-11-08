---
created: 2026-11-07
category: gotchas
related: [DaemonDeps, runDaemonMode, feature execution, test fixtures]
---

## Daemon execution fixtures must choose one dependency route

`DaemonDeps` is an exclusive union: scheduler fixtures provide either `runFeature` for a focused runner seam or `featureExecution` for the WorkOrder executor route, never both or neither. When tightening this boundary, update helper fixtures that previously supplied both routes.

### Why

The production daemon must have one execution implementation, while focused scheduler tests still need the runner seam. A permissive dependency type lets an accidental dual fixture conceal which path actually executed.

### Applies When

Adding or changing `runDaemon` fixtures, `DaemonDeps`, or daemon composition wiring.
