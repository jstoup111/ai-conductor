# Track: gh CLI version floor and fast-fail preflight

Track: technical

Scope boundary: Declare a minimum supported `gh` version and fast-fail on it at daemon start
and at DECIDE/engineer flow start; translate `gh`'s unsupported-`--json`-field error into a
named capability error inside the canonical `tracker-client` seam; state the floor in `README.md`
and the five `docs/` prerequisite tables. Excluded: a per-field capability registry probed against
a live PR, a standalone `conduct doctor` command, and closing the `worktree.ts:186` direct-`gh`
seam bypass. The floor's numeric value is deliberately left open for `/architecture-review` to
pin with an ADR.

Operator reliability work on internal tooling: no user-facing product capability and no
requirements worth a PRD, so acceptance criteria belong directly in stories.
