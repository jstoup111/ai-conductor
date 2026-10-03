# Conflict Check: Vitest daemon fixtures leak into shared operational OTel metrics (#2471)

**Date:** 2026-10-03
**Inventory:** all 536 story files, all 60 specs and the prior `.docs/conflicts/` reports, scanned by keyword for user config, OTel/OTLP/spool, `AI_CONDUCTOR_NO_REAL_EXEC`, the tmpdir leak guard and test tiers. 16 candidate story files were read in full.
**ADR corpus:** `repo_wide` (per `.ai-conductor/config.yml`). All 328 `adr-*.md` files were examined. 17 were narrowed in: `adr-014-otel-observability-exporter`, `adr-2026-07-01-machine-scoped-operator-identity`, `adr-2026-07-22-examples-state-isolation`, `adr-2026-07-22-canonical-tracker-client-seam`, `adr-2026-07-20-ci-fix-dispatch-via-steprunner`, `adr-2026-09-05-gh-cli-version-floor-and-environment-gate`, `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization`, `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`, `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`, `adr-2026-08-12-per-provider-live-smoke-legs`, `adr-2026-08-04-live-tier-provisions-its-own-provider-home`, `adr-2026-08-04-classify-before-spend-release-smoke-gate`, `adr-2026-07-27-project-config-scaffolder`, `adr-2026-08-09-conductor-block-single-source-of-truth`, `adr-2026-07-03-harness-daemon-profile`, `adr-2026-07-25-content-addressed-full-suite-proof`, `adr-2026-09-10-shared-step-lifecycle-telemetry`. The other 311 were narrowed out as off-subject: SDLC gates, halts and kickbacks, plan and story shape, rubrics, intake, git guards, release gates and providers. None was excluded as superseded.
**Result:** **PASS. Zero blocking conflicts remain.** One degrading contradiction was found and resolved by an operator-selected story change. No ADR-versus-story conflict was found.

## Conflict: OTLP refusal breaks tests that legitimately drive a loopback receiver

**Stories involved:** "Authenticated OTLP export" Story 1 vs Story 3 "OTLP network export is refused under the test marker"
**Files:** `.docs/stories/authenticate-otlp-export-with-env-referenced-heade.md` vs `.docs/stories/vitest-daemon-fixtures-leak-into-shared-operationa.md`
**Type:** contradiction
**Severity:** degrading
**Confidence:** 95%. The existing story's Done When is implemented by `test/integration/otel-authenticated-export.test.ts`, which calls `buildExporters` directly and exports to a loopback server under the standard setup, where the marker is set.

**Existing (verbatim):** "An integration case proves the constructed HTTP span exporter sends the configured header to a loopback OTLP endpoint."
**New (verbatim):** "Given the test marker is set and the smoke opt-in is not, when an otlp OTel config reaches daemon metrics wiring, interactive metrics wiring or the trace visualizer, then no OTLP network exporter is constructed and no network connection is attempted."

The construction-only cases in `test/engine/otel/transport.test.ts` would also fail. A loopback-endpoint allowlist is not a valid mediator, because the operator's shared collector also listens on localhost.

**Resolution Options:**
1. Make exporter construction accept an explicit environment (defaulting to the process environment). Tests that own a loopback receiver pass an environment without the marker for their own cases, so no global env is mutated, and user-config isolation still protects them.
2. Those tests delete `AI_CONDUCTOR_NO_REAL_EXEC` for their cases, following the existing tracker-client and live-smoke precedent.
3. Move the loopback test to the smoke tier, losing default header-sending coverage.

**Recommendation and operator selection (2026-10-03):** Option 1. Story 4 now carries the explicit-environment happy path, two negative paths (an explicit environment that still carries the marker is refused, and an absent explicit environment reads the process environment), and a Done When requiring both existing test families to pass under the standard setup without deleting the process marker.

## Near-misses the plan must respect (no conflict today)

- **Durable OTel spool** (`.docs/stories/durable-otel-export-queue-telemetry-is-buffered-wh.md`, Accepted; ADR-014 D15 and D16). No spool code exists on this base. Once it lands, the spool's direct-send fallback and its drainer are OTLP network paths that do not all pass through `buildExporters`. Whichever feature lands second must route them through the same refusal decision, and the spool's own tests must inject their transport or use the explicit environment from Option 1. The refusal decision should be one shared, importable helper so the spool can reuse it.
- **ADR-014 D5 and D12.** The refusal is a returned decision plus one `renderer_error` (rendererName `otel`), never a throw. Under the marker the refusal must be decided first, so the grpc spool-inactive warning and the non-empty-spool warning (D15 and D17) never fire alongside it.
- **Machine-scoped operator identity** (`adr-2026-07-01-machine-scoped-operator-identity`). Verified: `readMachineOwnerConfig` reads through `readUserConfig`, so the override isolates `spec_owner` too. Tests that need an owner seed it into the run-scoped directory.
- **Tmpdir leak guard** (`exempt-vitest-temp-dir-...`, `sweep-stale-vitest-run-temp-roots-...`, `reliable-disk-backed-test-temporary-storage-...`). The run-scoped user-config directory must be created inside the redirected run root, as the `AI_CONDUCTOR_ENGINEER_DIR` precedent in `test/setup.ts` is. A sibling in the real tmpdir would be flagged as a leak.
- **Smoke-gate ADR** (`adr-2026-08-07-smoke-gate-goes-live-without-precharacterization`). The Vitest include and exclude globs are not altered. The Story 4 guard derives "smoke tier" from `vitest.smoke.config.ts` include globs, not from a hand-kept list.
- **Explicit `home` argument.** `userConfigPath(home)` callers that pass `home` keep their explicit path, which wins over the env override. Only the defaulted call consults the override.
- **Live smoke** clears the marker for its own cases. It still inherits the run-scoped user-config location, which matches Story 1's marker-deleted negative path. No live-smoke story requires the operator's real user config.
