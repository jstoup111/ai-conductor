# Track: config-validation-gaps-satisfiesversion-and-six-ot

Track: technical

Scope boundary: every #1026 config-validation gap still true on main at 7fce82421, and nothing
beyond it (no wider validator audit). In scope:

1. `harness_version` — validation type-checks it as a string and rejects any value that is not a
   valid semver range; `satisfiesVersion` evaluates the constraint with the existing `semver`
   dependency (`satisfies`), so caret, tilde, range and exact forms are honoured rather than
   silently passing.
2. `loadMergedConfig` / `loadMergedConfigForRead` docstrings corrected to match the existing
   hard-fail on user-config `parse_error` (behaviour unchanged).
3. A step declaring both `when` and `parallel` is a validation error, as `types/config.ts` documents.

> **Amended 2026-09-28 by #1026:** item 3 is withdrawn. Conflict-check found that APPROVED `004-when-parallel-workflow-dsl` defines `when:` on a `parallel` group as supported (false skips every branch), with a shipped test; the `types/config.ts` comment claiming mutual exclusion is the defect. Scope is now: correct that comment only, no new validation.

4. The dead top-level `wiring:` key (validator and consumer retired in #1577) is accepted as a
   deprecated no-op with a deprecation warning; the orphan type comment is removed. Not an
   unknown-key rejection — no consumer config breaks.
5. `markdown_viewer` / `mermaid_renderer`: `command`, `args` and `mode` are required when the block
   does not name a preset (custom-command shape); preset-only blocks stay valid; the types are
   adjusted to express that shape.

> **Amended 2026-09-28 by #1026:** item 5 is refined per the operator-approved architecture diagram. `markdown_viewer` requires `command`, `args` and `mode` when `preset` is absent or `custom`. `mermaid_renderer` requires `preset`, which is the only field its renderer reads, and its `command`, `args` and `mode` become optional.

6. `otel.protocol` is validated against `http/protobuf | grpc`; any other value is a validation error.

> **Amended 2026-09-28 by #1026:** item 6 now disables telemetry instead of failing validation. Conflict-check found that accepted `.docs/stories/otel-observability.md` requires an invalid `otel` value to disable telemetry with a named error and never fail the run; the `otel.protocol` check therefore lives in `resolveOtelConfig` beside the `exporter` check, and config load is unaffected.

7. The step-disable and `when:` rejection messages describe the real rule (gating steps that opt in,
   such as `manual_test` and `prd_audit`, may be disabled).

Out of scope: auditing the validator for other documented-but-unenforced rules; plugin-manifest
`harness_version` (already semver-backed); changing user-config parse-error severity.

Config-validator hardening with no new capability or command — acceptance criteria belong in stories,
not a PRD.
