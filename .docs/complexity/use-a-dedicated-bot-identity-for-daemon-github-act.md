# Complexity: Optional bot identity for harness GitHub writes

Tier: M

## Signals

| Signal | Reading |
|---|---|
| New data models | None — one optional machine-scoped user-config block naming a token file |
| External integrations | None new — same `gh` CLI and `gh auth git-credential` helper, different credential |
| Auth / permissions | Yes — a second GitHub credential selected per operation access class |
| State machines | None — no new gate, step, or lifecycle state |
| Estimated stories | 4–6 |
| Surfaces touched | user config + anti-leak validation, guarded GitHub operation runner, remote-git push adapter, ConductorEvent union, operator setup docs |

## Rationale

Above **S** because the change introduces a second credential into the single guarded GitHub
write boundary (adr-2026-09-11-github-operation-ownership): which identity performs a write, how
it relates to the authorization actor (still the machine-resolved operator), and when a bot
failure may retry as the operator are design decisions needing an ADR, not plan tasks. The
config key must also inherit the machine-scoped anti-leak guarantee of
adr-2026-07-01-machine-scoped-operator-identity.

Below **L**: no new models, integrations, or state machines; routing keys off the existing
operation-registry access class, and read-path identity resolution is deliberately untouched.
The feature is optional and a no-op when unconfigured, so blast radius is bounded to operators
who opt in. Operator confirmed Tier M on 2026-09-23.
