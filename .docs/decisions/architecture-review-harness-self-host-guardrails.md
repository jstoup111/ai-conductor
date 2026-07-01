# Architecture Review: Harness Daemon Self-Host Guardrails

**Date:** 2026-06-30
**Feature:** Harness daemon self-host guardrails (Tier L, technical track)
**Inputs:** design doc `2026-06-30-harness-self-host-guardrails.md`, architecture diagram
`2026-06-30-harness-self-host-guardrails.md`, stories `harness-self-host-guardrails.md`
**Verdict:** APPROVED (3 ADRs, all APPROVED)

## Scope of review

Feasibility and architectural alignment of the five new components + config extension against the
existing conductor seams, before implementation. Grounded on the confirmed seam map (daemon
dispatch, build/finish steps, `install-freshness`, `writeHalt`, `HarnessConfig`/`validateConfig`,
`bin/install`, `test_harness_integrity.sh`).

## Decisions recorded

| ADR | Decision |
|-----|----------|
| adr-2026-06-30-self-host-detection-seam | One swappable `SelfHostDetector` seam gates the whole bundle; auto-detect + config override; EKS-identity swap point |
| adr-2026-06-30-sandbox-build-isolation | Throwaway `CLAUDE_CONFIG_DIR` linked to the worktree; no-leak + guaranteed-teardown contract |
| adr-2026-06-30-halt-based-release-gates | Version + release-artifact gates are HALT-based and fail-closed; daemon never merges |

## Feasibility findings

1. **Every attach point exists.** Detector → `daemon.ts` discovery/dispatch (beside owner-gating);
   relink → extends `ensureInstallFresh` (`install-freshness.ts`); sandbox → build step
   (`DefaultStepRunner`, `steps.ts`); gates → finish handling (`conductor.ts` + completion predicate
   `artifacts.ts`); HALT → `writeHalt` (`rebase.ts`); config → `HarnessConfig`/`validateConfig`
   (`types/config.ts`). No new subsystem required.
2. **`CLAUDE_CONFIG_DIR` is unused today** — introducing it is additive, no collision with existing
   env handling, but the child-process env plumbing in the build step must be confirmed to pass it
   through (plan task).
3. **Reuse over reinvention holds** — `InstallRunner`/`InstallStaleError`, `writeHalt`,
   `validateConfig`, `resolveHarnessRoot`, and the integrity script are all reused.

## Alignment / invariants preserved

- **ADR-005 (non-autonomy) + ADR-010 (single-owner):** preserved — all gates HALT, no merge entry
  point reachable from the self-build finish path (structural test, TR-12).
- **"Design for isolated EKS":** the detector is a swappable identity seam (mirrors the owner-gate
  `IdentityResolver`), so path comparison → platform identity is a later swap, not a rewrite.
- **Management-plane separation:** this feature touches only the build plane; the supervised-hosting
  spec (`2026-06-29-daemon-supervised-hosting.md`) is untouched. No overlap.
- **Owner-gate (PR #175):** composes with, does not modify. Self-host mode and owner-gating are
  orthogonal (identity-of-repo vs identity-of-spec-author).

## Risks / watch items (carried into stories + plan)

- **Isolation leak is the top risk** — a sandbox symlink resolving to global config would corrupt
  live sessions. Mitigation: explicit no-leak invariant + adversarial tests on pass/fail/crash
  branches (TR-5, TR-6).
- **Fail-open regressions** — a gate that treats a missing input as pass defeats itself. Mitigation:
  fail-closed decision recorded in ADR + asserted per gate (TR-8..TR-10).
- **Hot-path cost for other repos** — must be a single boolean check (TR-13 regression guard).
- **Injected-runner false confidence** — argv-only tests can pass on wrong argv
  ([[feedback_injected_runner_needs_real_binary_smoke]]); TR-4 requires a real-binary smoke test.

## Outcome

Design is feasible, aligned, and non-invasive to the normal path. Proceed to conflict-check and
plan. All three ADRs are APPROVED.
