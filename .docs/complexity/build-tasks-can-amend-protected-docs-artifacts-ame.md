# Complexity: BUILD tasks can amend protected .docs artifacts

Tier: M

Refs: jstoup111/ai-conductor#1293

## Rationale

Signals pushing above Small:

- **Two surfaces, not one.** A skill-contract change (DECIDE authors amendments) plus new
  deterministic enforcement machinery (a plan-task/protected-path cross-check reachable from
  the CLI and from a land-time gate).
- **Touches an existing state machine.** The protected-artifact seal already carries three
  tolerances (own-feature self-amendment, base-tip inheritance, rotation-on-rebase); the new
  rule must compose with all three without weakening tamper detection.
- **A known dead end must be routed around.** Autonomous remediation cannot rewind to a DECIDE
  step (`conductor.ts` HALTs instead), so mid-BUILD discovery needs its own designed route
  rather than reuse of an existing disposition.

Signals holding it below Large:

- No new models, no integrations, no auth, no persistence schema beyond one small marker file.
- The authoritative protected path set and fingerprint logic already exist and are reused, not
  reimplemented.
- Story count is expected in the 3–5 range.
