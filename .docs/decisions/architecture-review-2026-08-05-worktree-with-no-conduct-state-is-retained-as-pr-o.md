# Architecture Review: Worktree with no conduct-state is retained as pr-open-awaiting-main

**Date:** 2026-08-05
**Mode:** lightweight (Medium tier) — Feasibility + Alignment
**Requirements reviewed:** #1329 desired outcomes (technical track; no PRD)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Yes. All changes live in existing TypeScript engine modules (`daemon-dashboard.ts`, `daemon-runner.ts`, `daemon-cli.ts`). No new packages, services, or infrastructure. |
| Prerequisites | None. The processed ledger already stores `prUrl` (`daemon-dashboard.ts:211-235`), so the shipped-case evidence exists on disk today. |
| Integration surface | Two modules plus their CLI wiring. One optional outbound surface: a PR-state probe, injected the same way `daemon-cli` already injects `tracker.getIssueState`. |
| Data implications | None. No schema, no migration, no persisted format change. The `RetainedWorktreeEntry.reason` union widens; it is in-memory presentation state. |
| Performance risk | Addressed by design: the probe is optional and evidence-first, so `daemon status` performs no per-row network call in the default path. Option B (probe every row) was rejected in `adr-2026-08-05-worktree-classification-evidence-derived-reasons` for exactly this reason. |
| Worktree isolation | No new ports, services, or shared state. The dispatch-side change writes into a per-feature `.worktrees/<slug>/.pipeline/` path only. |

## Alignment

- **Deterministic where possible** (`CLAUDE.md` Design Principles): both changes are pure
  machinery — a classifier deriving from on-disk evidence, and an invariant enforced in the
  runner's error path. No LLM judgement is introduced. Aligned.
- **Observational/dispatch boundary:** the review confirms `daemon-dashboard.ts` is imported
  only by `daemon-cli.ts` and that `pickEligible` never consults retained classification. The
  design preserves that boundary — the reporting fix must not become a dispatch input, and the
  dispatch fix must not depend on the dashboard.
- **Daemon-ops rule 2** (`CLAUDE.md`): the operator lever must exist *before* anyone touches a
  feature's git state. The invariant ADR strengthens exactly that guarantee.
- **No retry spin** (#681 precedent): the design deliberately does not add automatic retry of
  errored dispatches; it makes the stop visible and clearable instead.
- **Diagram accuracy:** `.docs/architecture/worktree-with-no-conduct-state-is-retained-as-pr-o.md`
  matches this design (classification branches, derived reason, dispatch-side lever) and renders.

## Wiring Surface

| New/changed surface | Where it is called from in production |
|---|---|
| Never-started classification branch in `scanInheritedState` | Already-wired call site: `daemon-cli.ts:1605` (`renderStartupDashboard`) and the `daemon status` render path — no new entry point needed. |
| Derived retained-reason logic | Invoked inside `scanInheritedState`'s worktree loop; its output is consumed by `renderDashboard`'s RETAINED section (`daemon-dashboard.ts:687-694`). |
| Optional PR-state probe dependency | Injected into `scanInheritedState` by `daemon-cli.ts` at its existing call site, alongside `discover`/`log`, following the `tracker.getIssueState` injection pattern already used in the same function. |
| Exclusion reason + remedy rendering | Emitted by `renderDashboard` into the text `daemon status`/startup dashboard already printed to console and `.daemon/daemon.log`. |
| Slug-derived error-marker write | Called from the existing catch in `makeRunFeature` (`daemon-runner.ts:546-560`), which the daemon loop already reaches on every errored dispatch. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The true cause of the observed non-dispatch is something other than `createWorktree` throwing, so the stall recurs | Knowledge | Medium | High | The invariant is stated for **every** non-done outcome, not for one attributed path; the exclusion-reason rendering makes whatever the real cause is legible on the next occurrence. |
| A shipped-and-retained worktree with an open PR stops being excluded from dispatch (regression) | Technical | Low | High | Mandatory negative-path story + test: retained-with-open-PR must remain excluded from ELIGIBLE. |
| Widening `RetainedWorktreeEntry.reason` breaks a consumer | Technical | Low | Low | Sole consumer is `renderDashboard` in the same module (verified by grep). |
| Concurrent unmerged spec branches touch `daemon-dashboard.ts` | Integration | High | Medium | Advisory `overlap-scan` reports ~24 unmerged spec branches touching this file, notably `spec/651-park-all-dispatch-paths` and `spec/parked-feature-cleanup-can-never-fire-for-squash-m`. Rebase before build; keep the diff narrow and additive. |
| `daemon status` misleads while a probe is unavailable | Technical | Medium | Low | Reason degrades to an explicit unknown, never to a positive claim (ADR decision 3). |

## ADRs Created

- `adr-2026-08-05-worktree-classification-evidence-derived-reasons` — APPROVED
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` — APPROVED

## Conditions

1. **The negative path is mandatory.** A genuinely shipped-and-retained worktree whose PR is
   open must remain excluded from dispatch. This must ship with a test, not just a story.
2. **The dashboard must not become a dispatch input.** The reporting change stays
   presentation-only; no dispatch decision may start reading retained classification.
3. **No automatic retry.** The dispatch-side change makes the stop clearable; it must not
   introduce re-dispatch of an errored slug without an operator clearing the marker (#681).
4. **Unconfirmed attribution is recorded, not assumed.** The `createWorktree`-throws
   explanation (~35%) is not load-bearing for the design; no story may assert it as the
   confirmed cause.
