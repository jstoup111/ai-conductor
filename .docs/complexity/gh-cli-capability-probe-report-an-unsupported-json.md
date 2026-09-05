# Complexity: gh-cli-capability-probe-report-an-unsupported-json

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One: a declared `gh` version floor plus a typed capability-error result |
| External integrations | One existing: the `gh` CLI, via the canonical `tracker-client` seam |
| Auth / permission surface | None — the check reads `gh --version`, it authenticates nothing |
| State machines | None; the preflight is a single pass/fail at two entry points |
| Story count | 5-6 (version parse, daemon-start refusal, DECIDE-start refusal, seam translation, fail-closed negative path, documented floor) |
| Files touched | ~4 engine modules + tests, `README.md`, and 5 `docs/` prerequisite tables |
| New runtime code | A version-floor comparison module and its wiring at two entry points; a translating wrapper in `tracker-client.ts` |

## Rationale

The mechanism is small and well-bounded — parse `gh --version`, compare against a declared floor,
refuse with a named error — but it lands at two distinct entry points, adds a translating layer to
a module that explicitly declares itself the single seam for all real `gh` invocations, and must
preserve an existing fail-closed guarantee exactly (a genuinely missing or mismatched PR still
refuses to record an outcome). It also carries a live design question the ADR must settle: where
the floor is set, given that the minimum provably needed (v2.18.0) is far below the version that
clears the Projects-classic GraphQL breakage seen on the same old CLI.

Touching a declared seam and preserving a fail-closed invariant is what puts this above Small:
it warrants a diagram and an architecture review, and the story interactions between the two
entry points warrant a conflict-check. It is nowhere near multi-day. -> **Medium.**
