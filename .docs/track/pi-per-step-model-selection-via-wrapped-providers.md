# Track: Pi per-step model selection via wrapped providers

Track: technical

Scope boundary: All five #1885 desired outcomes. (1) Every Pi-dispatched step passes a deliberate `--model <provider>/<id>` and `--thinking <level>` (mapped from the harness `effort`), and the selection is visible in config and in step/provider events. (2) Per-step tiers, `by_tier` promotions, and effort are expressible for Pi, including different underlying providers within a single run. (3) Retry escalation and the availability fallback ladder walk Pi `provider/id` rungs, and each step is logged. (4) `bin/generate-model-table --check` passes with Pi represented; the table widens to N provider column pairs derived from the provider catalog, and Pi's cells read as config-required. (5) Config validation rejects a malformed or unknown Pi selection with a specific error, and a valid selection round-trips through resolved-config unchanged.

Decisions: a Pi model is a canonical `provider/id` string in every existing model-string slot, with no `:thinking` suffix because thinking comes from `effort`. The built-in Pi policy ships NO default models. When pi is configured anywhere, `llm_providers.pi.model` (Pi's native default, also used when pi is a fallback candidate), `llm_providers.pi.model_escalation_order` and `llm_providers.pi.model_fallback_ladder` are all required, and nothing is left to Pi's own default. The top-level `model_fallback_ladder` keeps applying to claude and codex but never to Pi. Syntax and underlying-provider checks run at config load. Model-id existence is checked at boot through `pi --list-models`, behind an injectable probe seam, on provider-dispatching entry points only. BUILD and tests never invoke a real Pi.

Added in architecture review (operator decision, 2026-09-29): the Pi adapter treats a terminal `stopReason: "error"` stream (exit 0) as a failed invocation carrying `errorMessage`, not a successful empty step. Classifying it as auth, rate-limit or model-unavailable stays with #2718.

Excluded: containment (#1886), self-host (#1887), skills/context (#1888), telemetry/cost (#1889), smoke parity (#1890), auth/rate-limit classification (#2718), and claude/codex model vocabularies.

Internal provider/config machinery with no end-user product requirements; acceptance lives in stories.
