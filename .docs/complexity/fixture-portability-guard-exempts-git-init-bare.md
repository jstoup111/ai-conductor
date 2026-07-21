# Complexity assessment: fixture-portability guard exempts `git init --bare`

Tier: S

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / entities | None. No schema, no data model. |
| Integrations | None. A pure string/regex matcher inside one test file; no subprocess, network, or cross-module wiring. |
| Auth / identity | Untouched. |
| State machines | None. Linear per-line scan: classify → exempt-or-violate. |
| Story count | 3 (bare-without-`-b` now violates; bare-with-`-b`/marker still passes; the `-b`-inside-`--bare` substring trap does not resurrect the exemption). |
| Files touched | One: `src/conductor/test/structural/fixture-portability.test.ts` (tighten `extractGitInitPattern`, add a `KNOWN_BAD_FIXTURES` entry, convert the two bare known-good cases). |
| Blast radius | Contained to the structural guard's own file and its falsifiability fixtures; no production source changes. |

All signals point to **Small**: a single self-contained matcher gains a precise
branch-flag detector plus a falsifiability fixture. Per the tier rules this Small
technical fix **skips** conflict-check, architecture-diagram, and
architecture-review; the land gate requires only track + stories + plan + this
complexity marker.
