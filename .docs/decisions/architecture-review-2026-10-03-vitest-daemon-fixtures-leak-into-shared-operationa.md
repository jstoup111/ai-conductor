# Architecture Review: Vitest daemon fixtures leak into shared operational OTel metrics
**Date:** 2026-10-03
**Mode:** Lightweight (Medium tier). Sections 2 and 4 only.
**Input:** Explore output (technical track, approach A, balanced scope) and the approved diagram
`.docs/architecture/vitest-daemon-fixtures-leak-into-shared-operationa.md`. Issue #2471.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

**Root cause (verified, 95%).** `daemon-cli.ts` loads each project through `loadMergedConfig`
(`src/engine/config.ts`), which layers `readUserConfig()` underneath the project config.
`readUserConfig` defaults to `userConfigPath(homedir())`, which is `~/.ai-conductor/config.yml`.
Neither `test/setup.ts` nor any Vitest config (default, e2e, smoke) isolates that path. The operator's
user config carries an `otel:` block with `exporter: otlp`, so a fixture project rooted in a
`mkdtemp` directory resolves an enabled OTLP config. `wireDaemonOtel` then exports metrics labeled
with the fixture project's identity. The exact test invocation that produced the observed series was
not reproduced (inferred, 85%), but every daemon-cli fixture that reaches `wireDaemonOtel` shares
this path.

**Secondary leak path (verified).** The repository's own `.ai-conductor/config.yml` also carries an
`otel: otlp` block. A test that loads config from the live repo root, rather than from a fixture
root, would export even after user-config isolation. This is why approach A keeps an
export-boundary backstop.

| Check | Finding |
|---|---|
| Stack compatibility | No new packages. Environment-variable override plus a guard in existing code. |
| Prerequisites | None. |
| Integration surface | Two modules: `engine/user-config.ts` (config location) and `engine/otel/transport.ts` (`buildExporters`), plus `test/setup.ts`. |
| Data implications | None. No persisted shape changes. |
| Performance | One env read per config read and per exporter build. Negligible. |
| Worktree isolation | Improves it. The user-config dir is run-scoped under the existing tmpdir leak-guard root (`RUN_TMP_ROOT_PREFIX`), so concurrent runs and worktrees never share it. |

**Single export seam (verified).** `buildExporters` is the only constructor of OTLP exporters. It is
called from `engine/otel/wire.ts` (`wireDaemonOtel`, `wireInteractiveOtelMetrics`) and from
`engine/otel/otel-visualizer.ts` (the per-run trace path, which `wireOtelVisualizer` and
`plugin-loader` reach). One guard there covers daemon metrics, interactive metrics and traces.

**Marker semantics (verified).** `AI_CONDUCTOR_NO_REAL_EXEC=1` is set by `test/setup.ts`, which all
three Vitest configs load. No production code path in `src/` or `bin/` assigns it; production only
reads it (`daemon-tmux.ts`, `ci-fix.ts`, `tracker-client.ts`, `engineer-cli.ts`,
`halt-issues/closer.ts`). Reusing it as the "under test" signal therefore cannot disable real daemon
export.

## Alignment

- **ADR-014 (`adr-014-otel-observability-exporter`, APPROVED) governs the exporter.** Its rule that
  an absent `otel` block means disabled stays intact. The backstop narrows only the network transport
  under the test marker. Exporter failures already never fail a run (Decision 5), and a refusal
  follows that rule: the run continues and the refusal is reported. The file exporter remains
  available under test, so telemetry behavior stays testable through local boundaries (desired
  outcome 2).
- **Event spine.** The refusal is reported through the existing `renderer_error` event (`rendererName:
  'otel'`), the same channel `wireDaemonOtel` already uses for attribute warnings. No new event type,
  sidecar or log channel is added, which satisfies the event-spine rule in `CLAUDE.md`.
- **User-config layering (`architecture-review-2026-07-26-daemon-merged-config-967`).** The
  user-under-project merge order is unchanged. Only the location of the user layer becomes
  overridable, which keeps the 967 contract.
- **Pattern consistency.** The env override follows the existing `AI_CONDUCTOR_ENGINEER_DIR`
  isolation in `test/setup.ts`: an env-selected directory, defaulting to the real home path in
  production, and pointed at a run-scoped tmpdir by test setup. The guard follows the
  `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch pattern in `daemon-tmux.ts`, where a real side effect is
  refused under the marker with an operator-legible reason.
- **No ADR created.** Neither seam changes a system boundary, decomposition, integration pattern,
  persistence model or platform. Both are guards on existing seams, and ADR-014 already governs the
  exporter. The structural prerequisite of §7 is not met.
- **Diagram.** `.docs/architecture/vitest-daemon-fixtures-leak-into-shared-operationa.md` (approved
  2026-10-03) matches this design.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `AI_CONDUCTOR_USER_CONFIG_DIR` env override in `userConfigPath()` | Read by `userConfigPath`, which `readUserConfig` and `writeUserConfig` call. Those are already called by `loadMergedConfig` / `loadMergedConfigForRead` (daemon-cli, conductor) and by the `ai-conductor config` user commands in `cli.ts`. Unset in production, so the default path is unchanged. |
| Network-export refusal in `buildExporters` | Already called from `wireDaemonOtel` and `wireInteractiveOtelMetrics` (`engine/otel/wire.ts`) and from `otel-visualizer.ts`. The refusal outcome is surfaced by those callers on the existing `renderer_error` event. |
| `AI_CONDUCTOR_OTEL_SMOKE=1` opt-in | Read only by the same guard. Set only by smoke-tier tests (`vitest.smoke.config.ts` include set), which default verification excludes. |
| `test/setup.ts` assignment of the user-config dir | Loaded by `vitest.config.ts`, `vitest.e2e.config.ts` and `vitest.smoke.config.ts` via `setupFiles`. |

Early overlap scan over these paths (`ai-conductor overlap-scan`, 2026-10-03): no overlap and no
open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Tests that `delete process.env.AI_CONDUCTOR_NO_REAL_EXEC` (`tracker-client.test.ts`, `daemon-cli-ci-fix-wiring.test.ts`, `daemon-tmux.smoke.test.ts`, the live e2e run body) bypass the backstop | Technical | Medium | Medium | User-config isolation still covers them, because they do not touch the user-config override. Condition 1 keeps the two layers independent. |
| A test that builds a child process env from scratch drops the override and re-reads the real `~/.ai-conductor/config.yml` | Technical | Low | Medium | The backstop still refuses OTLP when the marker survives. Stories cover a spawned-daemon path inheriting the override. |
| The durable OTel spool spec (#2848 lane) inserts a spooling exporter in `transport.ts` | Integration | Medium | Low | The guard must sit at exporter construction, before any spool wraps the network exporter (condition 3). `/conflict-check` re-examines this once stories exist. |
| An existing test asserts real `~/.ai-conductor/config.yml` content | Technical | Low | Low | Such a test is itself a leak. BUILD seeds the isolated dir explicitly where user-config behavior is under test (the precedent is `cli-config-user.test.ts`, which already passes an explicit path). |

## ADRs Created

None. The governing ADR is reused: `adr-014-otel-observability-exporter` (Decisions 1 and 5).

## Conditions

1. **Two independent layers.** User-config isolation must not depend on `AI_CONDUCTOR_NO_REAL_EXEC`,
   and the export backstop must not depend on user-config isolation. Each must hold when the other
   is absent.
2. **Production default unchanged.** With neither `AI_CONDUCTOR_USER_CONFIG_DIR` nor
   `AI_CONDUCTOR_NO_REAL_EXEC` set, config resolution and OTLP export behave exactly as today. Real
   daemon export keeps its configured project and worker identities.
3. **Guard at construction.** The refusal applies where the network exporter is built, so no OTLP
   connection is ever opened under the marker without the opt-in. Downstream wrapping (batching,
   spooling) cannot reintroduce it.
4. **Refusal is visible, not silent.** Each refused wiring emits one `renderer_error` naming the
   marker and the opt-in variable. It never fails the run (ADR-014 Decision 5).
5. **Opt-in is smoke-only.** `AI_CONDUCTOR_OTEL_SMOKE` is honored only alongside the marker.
   Default, e2e and acceptance tiers never set it.

## Blocking Issues

None.
