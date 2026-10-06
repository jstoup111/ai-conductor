# Architecture Review: Monitor guided sessions — choose provider, model, and effort

**Date:** 2026-10-06
**Mode:** Lightweight (Medium tier): §2 Feasibility and §4 Alignment in full
**Input reviewed:** PRD `.docs/specs/monitor-guided-sessions-no-way-to-choose-provider-.md`
(FR-1–FR-15); diagram `.docs/architecture/monitor-guided-sessions-no-way-to-choose-provider-.md`.
This is a pre-stories review, so no stories exist yet.
**Scope boundary (binding):** Balanced, per `.docs/track/monitor-guided-sessions-no-way-to-choose-provider-.md`.
Pi interactive launch is excluded (#1007).
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new packages. Claude Code 2.1.291 accepts `--model` and `--effort low\|medium\|high\|xhigh\|max` interactively (verified via `claude --help`). Codex 0.159.2 accepts `-m/--model` and `-c model_reasoning_effort=…` (verified via `codex --help`); its effort enum is a superset of the harness vocabulary (Context7 `/openai/codex`, `openai_models.rs`). Confidence 90%, verified. |
| Prerequisites | None. Config loading, the provider catalog, model policies, and the monitor seam all exist. |
| Integration surface | Four modules: config schema/validation, monitor command, monitor session/seam, and the provider catalog, plus one call-site adaptation in the composer launcher. This is at the 3+ boundary threshold, mitigated by a pure resolver and ADR D1's unchanged composer argv. |
| Data implications | None. Adds one optional top-level config block; there is no persisted state and no migration of existing config. |
| Performance risk | None; resolution runs once per monitor start. |
| Worktree isolation | Unchanged. The seam still launches with the halted feature's worktree as cwd (adr-2026-09-20-operator-launched-sessions-retain-conductor-authority D5). There are no new ports or shared resources. |

PRD open questions are resolved here:

- **Where the shared definition lives:** the catalog `interactiveLaunch` descriptor
  (new ADR D1).
- **Accepted efforts:** Claude and Codex both accept the full harness vocabulary today (D2).
- **How effort reaches interactive Claude:** as the `--effort` argument, not the env var (verified).

## Alignment

**Governing ADRs, reused:**
- **adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D2/D9:** the catalog owns
  per-provider capabilities, and `interactiveLaunch` fails closed. Pi stays refused under the D9
  refusal naming #1007. This feature *extends* the D9 descriptor's contract; it does not change D9's
  capability rule.
- **adr-2026-09-20-operator-launched-sessions-retain-conductor-authority D3/D4/D5/D8:** the seam
  remains the sole spawn point for monitor sessions, keeps its terminal-attached check and cwd, and
  stays bypassing the adapters (no daemon-session marker). D8's composer exemption is respected:
  the composer keeps its own spawn, and only its argv source changes.
- **adr-2026-09-20-halt-resolution-queue-derived-from-markers:** queue derivation is untouched.
  Refusals exit before queue processing, so FR-14's "queue unchanged" holds structurally.

**New structural decision:** moving ownership of the monitor's interactive invocation (including
model/effort and accepted values) from the seam module into the catalog is cross-module ownership
assignment. ADR `adr-2026-10-06-catalog-owned-interactive-model-and-effort` records it (APPROVED by
operator, 2026-10-06).

**Pattern consistency:**
- The config block follows existing provider/model/effort validation (`validateProviderSelection`,
  `VALID_EFFORTS`).
- The new top-level key must be registered in `CONFIG_CONSUMER_KEY_SETS` for the consumer-registry
  coverage gate.

**State:** the resolver output is a discriminated result (refusal | selection), and each value
carries an enumerated source (`override | config | default`). No boolean flags.

**Security boundaries:** model and effort values are passed as argv to an operator-owned process.
ADR D5's model-shape rule (not starting with `-`, no whitespace or control characters) prevents
option injection. Effort is a closed vocabulary.

**Event spine:** no new observation channel. The applied selection is operator launch output. The
existing session spine members are unchanged; adding the selection to them is not required by the
PRD and is not added.

## Wiring Surface

| New / changed surface | Production caller (design-time) |
|---|---|
| Guided-session config block (provider/model/effort) | Read by `loadMergedConfig` via the existing merged-config path. Validated in the config validator. Registered in `CONFIG_CONSUMER_KEY_SETS.top`, consumed by the monitor command's provider resolution in `engine/monitor-cli.ts` (replacing `resolveConfiguredProvider`). |
| Per-run provider/model/effort overrides | Parsed by the monitor command's existing argument parsing in `engine/monitor-cli.ts`, reached from the `conduct monitor` CLI dispatch. |
| Guided-session resolver (pure) | Called by `dispatchMonitorCommand` before queue membership is derived. |
| Launch output line (provider/model/effort + source) | Printed by `dispatchMonitorCommand` through its existing `print` dep before opening a session. |
| Extended `interactiveLaunch` descriptor (options argv + accepted efforts) | Consumed by the monitor seam (`execution/interactive-launch.ts` `launchInteractiveSession`) and the composer launcher (`engine/engineer-cli.ts`). |
| Selection carried through the guided session | `engine/monitor/session.ts` `openGuidedSession` passes model/effort into the seam's launch request. |

Overlap scan (advisory): `src/conductor/src/engine/config.ts` overlaps with
`origin/spec/daemon-self-host-guardrails`. No other overlaps.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Composer argv changes accidentally while the descriptor contract moves | Integration | Medium | Medium | A test pins the composer's Claude and Codex argv byte-for-byte before and after, including `CONDUCT_ENGINEER_PERMISSION_MODE`. |
| A model rejects a provider-accepted effort at runtime | Integration | Medium | Low | Out of scope by ADR D2. The provider CLI's own error surfaces in the operator's terminal. |
| Codex `--model` before the positional prompt is misparsed | Technical | Low | Medium | Option flags precede the prompt. A seam test asserts argv order with the process boundary mocked. |
| Config-key consumer-registry gate fails on the new top-level key | Technical | Medium | Low | Register the key and its consumer in the same task. |
| `config.ts` merge conflict with the open self-host-guardrails spec | Integration | Low | Low | Additive change; rebase. |

## ADRs Created

- `adr-2026-10-06-catalog-owned-interactive-model-and-effort` (APPROVED by operator 2026-10-06)

## Conditions

1. The composer's interactive argv for Claude and Codex is unchanged byte-for-byte (ADR D1). A test
   must pin it.
2. Every refusal happens before queue derivation and before any spawn. Tests mock the process
   boundary and assert it is never reached on refusal (CLAUDE.md "Test Process Isolation").
3. The new top-level config key is registered in `CONFIG_CONSUMER_KEY_SETS` with its consumer.
4. The PR changes the `conduct monitor` CLI surface (new flags). It must carry either a `## Migration`
   block or a release waiver per the repository release gate, since the change is additive.
