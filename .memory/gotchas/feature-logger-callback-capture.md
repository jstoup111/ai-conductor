---
created: 2026-07-26
category: gotchas
related: [src/conductor/src/engine/daemon-runner.ts, src/conductor/src/engine/daemon-deps.ts, daemon log feature tags]
---

## Feature diagnostics must not capture the global logger

When adding a feature-scoped daemon logger, callbacks created before the feature scope can silently retain `cfg.log` or `deps.log`. Pass the scope's logger explicitly to feature-owned adapters such as setup triage, quarantine surfacing, false-ship escalation, and engineer-signal persistence.

### Why

The primary runner and event paths can be correctly tagged while exceptional diagnostics remain global, leaving an incomplete attribution boundary.

### Applies When

Threading feature-local logging through daemon callbacks or injected dependency adapters.
