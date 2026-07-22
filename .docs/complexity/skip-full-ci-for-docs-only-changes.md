# Complexity assessment: skip full CI when a change is docs-only (`.docs/**` paths)

Tier: S

Source issue: jstoup111/ai-conductor#802

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / entities | None. A boolean predicate over a file list. |
| Integrations | None. Dependency-free `git diff` + bash; no third-party actions. |
| Auth / identity | Untouched. |
| State machines | None. No change to dispatch, gating, or lifecycle. |
| Story count | 5 (doc-only skips; ci-gate green; mixed runs full CI; undeterminable fails safe to CI; real job failure still fails the gate). |
| Files touched | `.github/workflows/ci.yml` (restructure: add `changes` + `ci-gate`, gate 3 jobs), new `.github/scripts/ci-detect-docs-only.sh` (pure predicate), new `test/test_ci_detect_docs_only.sh`, `test/test_harness_integrity.sh` (add `.github/scripts/` to bash-syntax coverage + run the new test), `README.md`, `CHANGELOG.md`. |
| Blast radius | Contained to the PR-time `ci` workflow. `release.yml`, `intake-label-sync.yml`, and all engine/CLI code untouched. |

Points to **Small**. The label carries both `size: S` and `size: M`; the deciding factor
is that this is a single-workflow restructure plus one ~15-line pure-bash predicate with a
focused unit test — no engine code, no schema, no state machine. **S.**

Per the tier rules this Small technical fix **skips** conflict-check,
architecture-diagram, and architecture-review; the land gate requires only track +
stories + plan + this complexity marker.

## Non-trivial details carried into the plan

1. The **aggregate `ci-gate` job** (`if: always()`, `needs` all heavy jobs) is the durable
   answer to the branch-protection wedge trap — it always reports a status and resolves
   green on doc-only PRs (heavy jobs `skipped`) while still failing on a real
   `failure`/`cancelled`. It is the only job the operator should ever mark required.
2. The **fail-safe default is `docs_only=false`** (run full CI) for empty/undeterminable
   diffs; `docs_only=true` requires **every** changed file to match the slash-anchored
   `^\.docs/`.
3. The predicate is **extracted to a testable script** (stdin file list → `docs_only=…`),
   not inlined in YAML, so the load-bearing logic is unit-tested (repo Design Principle).
4. No migration block / release waiver (no canonical breaking surface touched); no VERSION
   bump (pre-v1); CHANGELOG `[Unreleased]` entry required.
