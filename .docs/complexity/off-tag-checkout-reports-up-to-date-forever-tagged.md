# Complexity: Off-tag checkout reports up to date forever (#1437)

Tier: M

## Rationale

Scored against the standard signals (data models, integrations, auth, state machines,
story count):

| Signal | Assessment |
| --- | --- |
| Data models | None. No schema change — the fix deliberately avoids a new config key. |
| Integrations | None third-party. Local `git` invocations only. |
| Auth | None. |
| State machines | One small identity-resolution state set (`at <tag>` / `<tag>+N` / undeterminable) replacing an implicit two-branch conditional. |
| Story count | ~5 — identity resolution, always-printed identity line, off-tag reporting/offer, installer seeding, mirrored duplicate. |

Not **S**: the change spans four files (`bin/update`, `bin/conduct`'s byte-identical
duplicate of `check_harness_update_tagged`, `bin/lib/harness-common.sh`, `bin/install`),
renegotiates an accepted behavioral contract with two existing `#1005` tests that must be
rewritten, and lands beside in-flight work on the same surface (#1400 / #1412) whose
interaction has to be reasoned about explicitly.

Not **L**: no new subsystem, no schema or migration, no third-party boundary, no
concurrency or persistence concerns. The blast radius is one bash function and its
mirror, and the issue is labelled `size: M` by the filer.

Consequences of the M tier: `/architecture-diagram`, a lightweight `/architecture-review`,
`/conflict-check`, and `/coherence-check` are all required before landing.
