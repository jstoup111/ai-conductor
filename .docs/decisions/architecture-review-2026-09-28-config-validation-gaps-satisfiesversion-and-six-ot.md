# Architecture Review: Config validation gaps (issue #1026)
**Date:** 2026-09-28
**Mode:** Lightweight (Medium tier) — Technical Feasibility + Architectural Alignment
**Stories reviewed:** none yet (pre-stories review); input is the operator-confirmed scope in
`.docs/track/config-validation-gaps-satisfiesversion-and-six-ot.md` and the component diagram in
`.docs/architecture/config-validation-gaps-satisfiesversion-and-six-ot.md`.
**Verdict:** APPROVED

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. `semver` `^7.8.5` is already a runtime dependency (`src/conductor/package.json`) and already imported by `src/conductor/src/engine/plugin-manifest.ts` (`import { satisfies } from 'semver'`). `semver.validRange` and `semver.satisfies` are both part of the semver 7 public API. Confidence 97%, verified (package.json + existing import); API shape from the semver 7 README. |
| Prerequisites | None. No migration, no external setup. |
| Integration surface | One module and its type file: `src/conductor/src/engine/config.ts`, `src/conductor/src/types/config.ts`, plus `docs/reference/configuration.md` (its "Known limitation" note for #1026 at the `harness_version` entry becomes false and must be corrected). One module boundary. |
| Data implications | Config-surface tightening only. Previously accepted inputs that now fail: a non-string or non-semver-range `harness_version`, a step with both `when` and `parallel`, an `otel.protocol` outside `http/protobuf`/`grpc`, a `markdown_viewer` with no preset (or `custom`) lacking `command`/`args`/`mode`, and a `mermaid_renderer` with no `preset`. Every live config on this machine was scanned — this repo, `~/.ai-conductor/config.yml`, and the four other registered projects — and none trips any new rule: the two `harness_version` users pin `">=0.99.0"` (valid range, satisfied by `VERSION` 1.5.0); the user config sets `markdown_viewer.preset: glow` and `mermaid_renderer.preset: html`. Confidence 95%, verified by grep. |

> **Amended 2026-09-28 by #1026:** item 3 is withdrawn. Conflict-check found that APPROVED `004-when-parallel-workflow-dsl` defines `when:` on a `parallel` group as supported (false skips every branch), with a shipped test; the `types/config.ts` comment claiming mutual exclusion is the defect. Scope is now: correct that comment only, no new validation.

> **Amended 2026-09-28 by #1026:** item 6 now disables telemetry instead of failing validation. Conflict-check found that accepted `.docs/stories/otel-observability.md` requires an invalid `otel` value to disable telemetry with a named error and never fail the run; the `otel.protocol` check therefore lives in `resolveOtelConfig` beside the `exporter` check, and config load is unaffected.
| Performance risk | None — constant-cost checks at config load. |
| Worktree isolation | No ports, databases, services, or shared files. |

**Edge the design must close (verified by reading, 90%):** `semver.validRange('')` returns `'*'`,
so an empty `harness_version: ""` would pass as "any version" through `validRange` alone. Today an
empty string is falsy and skips the gate entirely (`loadProjectConfig` guards on
`validation.config.harness_version`). The validator must reject the empty string explicitly so the
gate is never silently vacuous; an explicit `"*"` stays accepted because the operator wrote it.

**Non-string crash (verified by reading, 90%):** `harness_version: 1` currently passes
`validateConfig` (the key is only on the top-level allow-list) and reaches
`constraint.match(...)` in `satisfiesVersion`, which throws a `TypeError` instead of returning a
`ConfigResult` error. The new type check at validation removes that path.

## Alignment

- **Domain boundary:** all changes stay inside config validation; no other module learns new
  rules. The only consumer-side edit is `satisfiesVersion`'s body, which remains the single
  evaluation point called from `loadProjectConfig`.
- **Pattern consistency — local precedents (rediscovery hints, not coordinates):**
  - *Retired top-level key → deprecated no-op.* Role: the established way to retire a config key
    without breaking consumers. Traits to preserve: push a human-readable warning naming the key
    and the retiring ADR, push `{ key, adr }` onto `deprecatedKeys` so
    `emitDeprecatedConfigKeyEvents` puts it on the event spine, and delete the key from the
    returned config. Why it applies: `wiring` is exactly a retired key (validator and type removed
    by the change that landed `adr-2026-08-14-retire-build-review-wiring-rubric`). Allowed
    variation: message wording. Hints: `DEPRECATED_BUILD_REVIEW_ADR`, the
    `build_review.perTaskFloor` retirement branch inside `validateConfig`.
  - *Semver constraint evaluation.* Role: the other `harness_version` in the codebase (plugin
    manifests). Traits: delegate range grammar to `semver`, never hand-parse. Hints:
    `plugin-manifest.ts`, `satisfies` import.
  - *Per-block validators return the first `ConfigError`.* New checks for `otel.protocol`,
    viewer/renderer required fields, and `when`+`parallel` follow the existing
    `validateXxxBlock(raw): ConfigError | null` shape and name the offending key path in the
    message. Hints: `validateMarkdownViewerBlock`, `validateMermaidRendererBlock`.
- **Governing ADRs:** `adr-2026-08-14-retire-build-review-wiring-rubric` (APPROVED) already
  governs the `wiring` retirement; this change applies it to the one leftover allow-list entry and
  cites it as the deprecated key's ADR. No APPROVED ADR governs `harness_version` semantics,
  viewer/renderer shapes, or `otel.protocol`, and none of those changes is structural.
- **State management:** `MermaidRendererConfig` currently declares `command`/`args`/`mode` required
  though `renderDiagramsForFile` (`mermaid-renderer.ts`) reads only `preset`; `MarkdownViewerConfig` declares them required though
  `bin/lib/harness-common.sh` falls back to defaults when absent. The confirmed per-shape rule
  (renderer: `preset` required, others optional; viewer: `command`/`args`/`mode` required when
  `preset` is absent or `custom`) makes the types describe what the consumers actually read.
- **Security boundaries:** no new inputs beyond config fields that are already parsed; every new
  rule narrows accepted input.
- **Production DI defaults:** unaffected.
- **Diagram accuracy:** the feature diagram reflects the design; no container/system-context
  change.

## Wiring Surface

No new production surface is introduced; every change edits an existing, already-wired function.

| Surface | Production caller (design-time) |
|---|---|
| `harness_version` type + range check | inside `validateConfig`, reached from `loadProjectConfig` / `loadMergedConfig` on every config load |
| `satisfiesVersion` (semver-backed) | existing call in `loadProjectConfig`, fed by `readHarnessVersion()` from the CLI entry |
| `when` + `parallel` exclusion | inside `validateConfig`'s per-step loop |
| `wiring` deprecation | inside `validateConfig`; warning + `deprecatedKeys` consumed by the existing `emitDeprecatedConfigKeyEvents` |
| viewer / renderer required fields | existing `validateMarkdownViewerBlock` / `validateMermaidRendererBlock` |
| `otel.protocol` check | new check inside `validateConfig`'s `otel` handling (currently allow-list only) |
| disable / `when:` rejection messages | existing `stepSkipAuthorityError` inside `validateConfig` |
| loadMergedConfig / loadMergedConfigForRead docstrings | documentation only |

> **Amended 2026-09-28 by #1026:** the `when` + `parallel` exclusion row is withdrawn (ADR 004 supports the combination; only the type comment is corrected), and the `otel.protocol` check moves from `validateConfig` into `resolveOtelConfig` (`src/conductor/src/engine/otel/otel-config.ts`), reached from `plugin-loader.ts` and `daemon-cli.ts`; an unsupported protocol disables telemetry with a named error.

Overlap scan (advisory): `ai-conductor overlap-scan` reports unmerged
`origin/spec/daemon-self-host-guardrails` also touching `src/conductor/src/engine/config.ts`.
Different regions are expected; the plan should keep edits local to the functions above.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A consumer project pinned a constraint `semver` rejects (e.g. `"latest"`) and now fails config load | Data | Low | Medium | Error names `harness_version` and the rejected value; release note under `Fixed`. All five registered projects verified compatible. |
| `validRange('')` treats empty as `*`, making the gate vacuous | Technical | Medium | Medium | Explicit empty-string rejection in the validator (design requirement above). |
| Existing tests assert the old disable message text (`test/engine/config.test.ts`) | Technical | High | Low | Update those assertions in the same task that changes the message. |
| `semver.satisfies` excludes prerelease installed versions by default | Technical | Low | Low | `VERSION` is a plain release (1.5.0); the release bot writes release versions only. |

## ADRs Created

None. No change here meets the structural prerequisite (no boundary, decomposition, integration
pattern, state architecture, or foundational-technology decision). The `wiring` retirement reuses
`adr-2026-08-14-retire-build-review-wiring-rubric`.
