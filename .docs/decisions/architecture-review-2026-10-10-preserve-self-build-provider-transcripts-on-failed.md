# Architecture Review: Preserve self-host provider transcripts
**Date:** 2026-10-10
**Mode:** Lightweight (Medium tier), pre-stories, technical track
**Input:** `.docs/track/preserve-self-build-provider-transcripts-on-failed.md`, approved diagrams
`.docs/architecture/preserve-self-build-provider-transcripts-on-failed.md` and
`.docs/architecture/sequences/preserve-self-build-provider-transcripts-on-failed.md`, intake #611
**Verdict:** APPROVED WITH CONDITIONS

Scope boundary (binding, from the track marker): comprehensive — every self-host step and
auxiliary member across every self-host provider; allowlisted harvest before every release
including the dead-owner sweep; verdict-based retention with a cap; spine events; a read-only
`ai-conductor transcripts` reader. No credentials, no change to scratch-home lifetime, no consumer
builds.

## Feasibility

| Check | Finding | Confidence / basis |
|---|---|---|
| Stack | No new dependency; Node `fs` glob/copy only. | 95% verified |
| Prerequisites | None. Scratch homes, the dead-owner sweep, and the event spine exist. | 95% verified |
| Transcript location | Providers write sessions inside the self-host home: Claude `projects/«cwd»/«id».jsonl` (+ per-session subdirs), Codex `sessions/YYYY/MM/DD/*.jsonl`, Pi `sessions/«cwd»/*.jsonl`. | 85% inferred from local `~/.claude`, `~/.codex`, `~/.pi/agent` plus the home variables in `provider-catalog.ts` (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`) |
| Teardown order | `SandboxBuildEnv.teardown()` and `ProviderHome.teardown()` `rm` the home **before** `releaseScratchHome`; so the harvest must sit in teardown, not in `releaseScratchHome`. | 95% verified (`sandbox-build-env.ts` teardown, `provider-home.ts` teardown) |
| Verdict timing | `build_stall` (incl. `no_task_progress`) is emitted in `conductor.ts` after the dispatch returns, i.e. after teardown — retention must be post-verdict. | 90% verified (dispatch call precedes the `build_stall` emit in the same block) |
| Secrets | Pi and Codex homes contain `auth.json`; Claude's holds propagated state. Allowlist-only copy is mandatory. | 95% verified (Pi/Codex), 80% inferred (Claude) |
| Data | No schema/DB. New gitignored dir under `.pipeline/`; size bounded by a cap. | 95% |
| Performance | One copy per attempt; Claude transcripts can reach tens of MB. Copy is bounded I/O at teardown. | 80% inferred |
| Worktree isolation | Captures are per-worktree; `.pipeline` is already on `LIVE_CHECKOUT_VOLATILE`, so a self-host build writing there cannot trip the live boundary. No new exclusion. | 90% verified (scratch ADR cites `live-boundary.ts` volatile list) |

## Alignment

- **Scratch lifecycle** — governed by `adr-2026-08-09-worktree-local-provider-scratch`. Home
  lifetime is unchanged (still attempt-scoped, still removed in `finally`, sweep still
  liveness-based). Its "a home has no post-attempt value" assertion is falsified; amended in place
  with an amendment note.
- **Event spine** — all lifecycle transitions are new `ConductorEvent` variants; the reader reads
  `.pipeline/events.jsonl`. No sidecar index, no new channel. Captures themselves are durable
  artifacts read by name (event-spine exception for state, not telemetry).
- **Provider seam** — preservation is declared per provider on the self-host shape, matching how
  `homeVariable`, `scrubVariables`, and `selectedAuthPath` are already declared. Required by type
  (machinery over prompt discipline).
- **Domain types** — a capture has an explicit lifecycle (pending → retained | pruned → evicted);
  model it as a discriminated state, not booleans. Verdict-to-retention mapping must be an
  exhaustive switch with no default arm.
- **Security** — allowlist only; harvest never follows symlinks out of the home (Claude homes
  symlink `skills/` and `hooks/` into the harness).

**Focused local pattern basis.** The dead-owner sweep's "fail toward retention" rule
(`provider-scratch.ts`, `collectLegacyScratch` / `sweepScratch` retain-with-reason decisions) is
the precedent for retention: when the verdict is unknown or the harvest is ambiguous, keep and
report. Variation allowed: captures are evicted by a count/size cap, which the sweep does not
have.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `transcripts.globs` + extractor on self-host shape | Read by the harvest routine; declared in `BUILT_IN_PROVIDERS` in `provider-catalog.ts` |
| Harvest-then-remove retirement routine | Called from `SandboxBuildEnv.teardown()`, `ProviderHome.teardown()`, and the dead-owner sweep reclaim (`sweepScratch` / `sweepFeatureWorktreeScratch`, reached from `daemon-cli.ts` `sweepProviderScratch`) |
| Transcript retention resolver | Called by the conductor where a step's outcome is settled — the step-result handling around the self-host dispatch and the `build_stall` emit in `conductor.ts` |
| `provider_transcripts_*` events | Emitted via the existing `ConductorEventEmitter`; persisted by `EventPersister` |
| `ai-conductor transcripts` subcommand | Registered in the CLI command routing in `src/conductor/src/index.ts`, beside `shipped-record` |

Advisory overlap scan: overlaps only with `origin/spec/daemon-self-host-guardrails` and
`origin/spec/self-host-phase6-wiring` (July spec branches) on `sandbox-build-env.ts` and
`conductor.ts`. Not blocking.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A retirement path deletes a home without harvesting | Technical | Medium | High | One routine owns removal; integration test asserts every teardown and the sweep harvest first |
| Credential copied out of a home | Security | Low | High | Allowlist globs only; no symlink following; test with `auth.json` present asserts it is not copied |
| Secret echoed inside a transcript is persisted | Security | Medium | High | Every captured line passes through `redactSafetyText` (FR-14 of `codex-safety-and-self-host-parity-907`); the reader sanitizes again on print |
| Harvest failure breaks teardown or flips a step result | Technical | Low | High | Best-effort, emitted as harvest-failed; tests assert step result and removal unchanged |
| Unbounded disk growth | Performance | Medium | Medium | Count/size cap with eviction event |
| Provider changes its on-disk layout | Integration | Low | Medium | Globs live on the descriptor; zero-file capture is reported in the captured event so drift is visible |
| Captures lost on worktree removal before #564 | Data | Medium | Low | Documented consequence; #564 owns durability of `.pipeline` |

## ADRs Created

- `adr-2026-10-10-retain-self-host-provider-transcripts` — new durable artifact store and a
  change to the scratch retirement seam (state/data architecture). APPROVED by operator 2026-10-10.
- Amended: `adr-2026-08-09-worktree-local-provider-scratch` (amendment note only).

## Conditions

1. Release gate: resolved at plan time. The self-host release gate's `bin/conduct CLI` surface is
   triggered only by a change to the `bin/conduct` file itself (`version-signal.ts`
   `detectMajorSurfaces`); the new subcommand is routed in `src/conductor/src/index.ts` and is
   additive, so no migration block or waiver is required. The implementation PR declares
   `Release-Disposition: note`, `Release-Category: Added`.
2. Verdict-to-retention mapping is an exhaustive switch over step outcomes (no default arm).
