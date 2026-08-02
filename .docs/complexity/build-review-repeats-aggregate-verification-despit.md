# Complexity: Scoped BUILD/review commands cannot silently expand to the aggregate suite

Tier: M

## Signals

| Signal | Reading |
|---|---|
| New data models | None — reuses `TestSuiteConfig` (`types/config.ts:392`) |
| External integrations | None |
| Auth / permissions | None |
| State machines | None — no new gate, step, or lifecycle state |
| Estimated stories | 3–5 |
| Surfaces touched | engine config validation, project npm scripts, a scoped-run invocation interface, HARNESS/docs |

## Rationale

Above **S** for two reasons that carry real design risk rather than volume:

1. **Consumer-compatibility risk.** An engine-side check that rejects a
   `test_suite.command` whose shape discards forwarded args can reject configs that
   already exist in consumer projects. Whether that check warns or fails closed, and
   how it is introduced without breaking existing repos, is an architectural decision —
   it needs `/architecture-review` and an ADR, not just a plan task.

2. **CLI surface.** A first-class scoped-run interface touches `bin/conduct CLI`, one of
   the `CANONICAL_BREAKING_SURFACES` in the self-host release gate, so the change must
   resolve to either a real migration block or a waiver. That classification decision
   belongs in DECIDE.

Below **L**: no new models, integrations, auth, or state machines; the blast radius is a
config validator, a set of npm script definitions, and one invocation interface. The
verification machinery it protects (`FullSuiteVerifier`) is already built and is not
modified.

## Conflict surface

Scope was deliberately narrowed away from #1176 (evidence reuse across gates, BUILD tail
latency, review-size targets, model-tier shadow calibration) and #1205 (partial sibling
BUILD-verification capability after rebase). `/conflict-check` must confirm this feature
introduces no story that re-implements those.
