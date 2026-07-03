# Complexity: daemon issue-priority scheduling

Tier: M

## Rationale

- **Scope:** single subsystem (daemon backlog discovery/ordering) — no new data models, no
  auth, no state machines. Points toward S.
- **But:** introduces a network read (gh issue labels) into `discoverBacklog`, a path that is
  deliberately offline-capable today, and changes the scheduling semantics of the daemon's
  keystone merged-is-truth discovery. Fail-soft design, per-scan caching, and ordering
  precedence deserve a lightweight architecture review and a conflict check against the
  owner-gate / backlog-dedup behavior.
- **Story count:** ~5 (band ordering, label fetch + fail-soft, unlabeled/no-issue placement,
  observability, docs).

M = lightweight architecture review, conflict-check runs, full artifact set required at land.
