# Architecture Review: ship→CI feedback loop + fixture-portability guards
**Date:** 2026-07-07
**Mode:** Lightweight (tier M) — feasibility + alignment
**Input reviewed:** explore output + technical intent (technical track, no PRD); approved diagram `.docs/architecture/ship-ci-feedback-loop.md`
**Verdict:** APPROVED

## Feasibility

- **Stack:** no new dependencies. `gh` CLI (already the single GitHub seam via `GhRunner`),
  vitest structural test (pattern exists: `non-autonomy.test.ts`).
- **Data already in hand:** `prMergeState` fetches `statusCheckRollup` per watched PR on every
  sweep tick — the feature adds interpretation, not polling. One additive field on
  `PrMergeState`; one additive field on `WatchEntry` (`ciFixAttempts`, with the same
  zero-default legacy normalization `resolveAttempts` already uses).
- **Dispatch scaffolding exists:** `withResolveWorktree` (isolated worktree at PR branch tip,
  serial guards, stale-worktree cleanup), acceptance guards, suite gate, push-refreshed — all
  built for Task-17 conflict autoresolve and reusable for a fix-CI resolver.
- **Integration surface:** mergeable-sweep.ts, pr-labels.ts, daemon-cli wiring, events type,
  build-failure-escalation — all within the engine domain; no cross-domain reach.
- **Prerequisite:** none external; `ci_watch.enabled` config key is additive (consumer docs
  updated in-PR per Docs-track-features).
- **Log-excerpt fetch** is the only inferred capability (~90%: `gh pr checks` +
  `gh run view --log-failed`); degradation path (check names + links) keeps the design intact.

## Alignment

- **Pattern consistency:** mirrors the existing injected-dispatch seam (`AutoresolveDispatchOpts`)
  rather than inventing a new orchestration path; bounding mirrors `MAX_KICKBACKS_PER_GATE`;
  label lifecycle mirrors `mergeable`/`needs-remediation` conventions (REST via `gh api`, not
  GraphQL — per adr-015/PR #172 lineage).
- **Prior ADR compatibility:** extends the sweep the same way
  adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep did for conflicts — CI failure is the
  second sweep-observed defect class routed to bounded resolution. No APPROVED ADR is
  contradicted; daemon-false-ship-guard (#337) is complementary (it guards ship evidence; this
  guards post-ship health).
- **Duplicate-dispatch safety:** the processed ledger and spec-hash dedup are untouched
  (explicit rejection of Option B); remediation is keyed to the PR branch, not the spec.
- **Worktree isolation:** fix runs use `.worktrees/resolve-«slug»`-style isolated worktrees;
  primary checkout untouched; serial in-flight guard prevents concurrent-slug collisions.
- **State management:** attempts live in the durable watch entry, bumped before git work
  (crash-safe); exhaustion converges to sticky `needs-remediation` + HALT — invalid
  "silently looping red PR" state is unrepresentable.
- **Autonomy boundary:** pushing to shipped PRs is new; it is bounded (2), config-gated
  (default on, operator-confirmed), ✋-visible, and never merges — merge authority remains
  human-only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Flaky CI check burns fix attempts on a healthy PR | Integration | Medium | Medium | attempts reset on green observation; exhaustion = HALT not loop; `ci-failed` label removed on green |
| Log excerpt unavailable (external checks, token scope) | Integration | Low | Low | RETRY hint degrades to check names + links |
| Fix run pushes a wrong "fix" to a shipped PR | Technical | Low | Medium | acceptance guards + full suite gate pre-push; CI re-verifies; bounded attempts; human merges |
| Sweep tick latency grows during a dispatch | Performance | Medium | Low | one dispatch per tick, serial guard, sweep stays best-effort/non-throwing |
| Guard meta-test false-positives on exotic exec shapes | Technical | Medium | Low | escape-hatch marker + falsifiability tests; guard scoped to test/** |

## ADRs Created

- `adr-2026-07-07-ship-ci-feedback-loop.md` — APPROVED by operator 2026-07-07 (decision
  categories: integration pattern — new sweep-dispatched remediation flavor; cross-cutting —
  autonomous push to shipped PRs; infrastructure — new config key + CI-facing guard test).

## Conditions

None. (Verdict is clean APPROVED; the single DRAFT ADR requires operator approval before
stories, per §7b — enforced by the engineer land gate as well.)
