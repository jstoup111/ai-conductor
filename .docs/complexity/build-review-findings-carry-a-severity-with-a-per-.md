# Complexity: build_review findings carry a severity with a per-rubric advisory threshold

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | A closed severity vocabulary on both finding shapes; an advisory classification beside `suppressed`; an adjudicator `advisory` per-source outcome |
| External integrations | None |
| Auth / permission surface | None |
| Contract changes | Built-in judged contract v3→v4 and custom contract v1→v2 (required field); dispositions recorded against the old version invalidate |
| Persisted state | Remediation case store gains durable advisory entries (threshold-advisory and adjudicator-downgraded), keyed by finding id |
| Configuration | New `min_severity` key on `build_review.rubrics.<id>` and `build_review.custom_rubrics.<id>`, validation, resolution, config-consumer registry, reference docs |
| Telemetry | `build_review_outer_verdict` gains advisory findings; adjudication events carry the downgrade outcome |
| Operator surfaces | `build-review findings` CLI human and JSON output; a new engine-owned PR body region |
| Skills | Three built-in rubric skills plus the custom-rubric contract (severity guidance per concern kind), and `remediate` (downgrade outcome) |

## Rationale

The change crosses every layer of the build_review pipeline:

- reviewer contract and parser;
- configuration;
- the two effective-verdict reducers and the adjudication coordinator's live-source set;
- the adjudicator's output schema and the reducer that routes its cases;
- the durable remediation case store;
- the event spine;
- the CLI and PR publication.

It amends decisions in an approved ADR (`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`, D4.x floor semantics), so it needs a full architecture review. Two contract version bumps, plus a new adjudication outcome that must persist across laps without re-litigation, make this more than Medium. Expected stories: 7–9. → **Tier L.**
