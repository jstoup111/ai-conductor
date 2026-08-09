# Intake origin: no-operator-command-to-reseal-a-protected-decide-a

Source-Ref: jstoup111/ai-conductor#1281
Owner: jstoup111

## Desired outcome

- A `conduct reseal` command exists that re-fingerprints named protected artifacts in a
- It is scoped to an explicit, enumerated list of artifact paths — never a blanket
- It refuses to run without a stated rationale, and records an audit entry (who, which
- It optionally clears `.pipeline/HALT` / `HALT.class` when the reseal resolves the halt
- `docs/runbooks/stalled-or-stuck-feature.md` documents the recovery as a command, and
- A genuine feature-authored BUILD/SHIP edit to a protected artifact still halts; reseal
