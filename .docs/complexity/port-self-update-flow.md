# Complexity: port-self-update-flow

Tier: M

## Signal assessment

| Signal | Reading | Tier |
|--------|---------|------|
| Data models / persistence | None new. Reads/writes the existing `~/.claude/ai-conductor.config.json` keys (`updateChannel`, `autoCheck`, `currentVersion`, `lastCheckedAt`) already defined. | S |
| Integrations | git (fetch/tags/checkout/pull/rev-parse/merge-base), the filesystem, `bin/migrate`, the configured markdown viewer. All pre-existing. | M |
| Auth / identity | None. | S |
| State machine | No persistent FSM, but several behavioral branches: channel dispatch (tagged/main), TTY vs no-TTY, up-to-date vs behind, migrate-success vs rollback, seed-on-first-run. | M |
| Concurrency | None introduced. | S |
| Story count | ~8 behavioral-equivalence stories (channel set + validation, tagged update happy path, main update happy path, no-TTY guidance, changelog render, migrate-failure rollback, first-run seeding, auto-check disabled). | M |
| Correctness risk | High — a v1.0 cutover **blocker** (#226/#228). Silent behavior drift removes consumers' ability to update. Behavior must be byte-for-byte preserved. | M |

## Verdict

**Tier: M (Medium).** Not Small: it is a multi-command port with several behavioral
branches, a companion HARNESS.md documentation change, and correctness-critical
behavior-preservation requirements. Not Large: no new data models, no new
architecture, no auth, no concurrency — it relocates existing, well-understood
logic.

## DECIDE consequences (Medium)

- PRD: **skipped** (technical track).
- architecture-diagram: **included** (component/flow diagram of the extracted script).
- architecture-review: **lightweight**, with one APPROVED ADR recording the
  standalone-bash decision.
- conflict-check: **included**.
- stories + plan: **required**.
