# Conflict Check: build_review judgement gate (build → manual_test seam)

**Date:** 2026-07-07
**New stories:** `.docs/stories/add-a-judgement-gate-at-the-build-manual-test-seam.md`
**Scope scanned:** all `.docs/stories/` files; all unmerged `origin/spec/*` branches (spec-only —
zero engine diffs to `steps.ts`/`conductor.ts`/`resolved-config.ts`); open PRs #267, #392, #72,
#323, #335, #151, #19, #18.
**Result:** PASS — zero blocking conflicts. One degrading (sequencing) conflict accepted; three
reconcile notes folded into the stories.

## Conflict: shared manual_test entry + kickback machinery with manual-test-fail-routing (#367)

**Stories involved:** build_review TS-1/TS-5/TS-6 vs `manual-test-fail-routing.md`
**Type:** state-conflict / resource-contention (same `manual_test` registry entry, same
`build …→ manual_test` topology seam, same `MAX_KICKBACKS_PER_GATE` bound, sibling self-heal
counters both kicking back to `build`)
**Severity:** degrading (sequencing) — both push the same gating-hardening direction; no logical
contradiction.

**Resolution (accepted):** #367's mechanics (gating enforcement, whitewash guard, the
`manual_test → build` self-heal block) are already landed on main (verified at
`artifacts.ts:689-764`, `conductor.ts:1650-1703`). build_review lands second and reconciles
against current code by construction: it edits the current `manual_test` entry
(`prerequisites → ['build_review']`) and adds its own gate-keyed counter alongside the existing
one. A joint test (build_review FAIL → fix commits → whitewash guard sees HEAD move) is included
in TS-5's coverage.

## Reconcile notes (compatible; stories amended 2026-07-07)

1. **Kickback counter model** (vs `daemon-logs-surface-kickback-steps-visibly.md`, #240):
   `buildReviewSelfHeals` is the existing gate-keyed per-gate counter keyed by `build_review` —
   not a second parallel counter registry. TS-6 amended.
2. **Rebase re-verify set** (vs `rebase-resolution-skill.md`): a code-changing rebase resolution
   that re-opens `build` must stale `build_review` before `manual_test` is selectable; re-verify
   set is `{build, build_review, manual_test}`. TS-5 amended.
3. **Test isolation** (vs `conductor-test-suite-leaks-a-real-pipeline-halt-in.md`, #252): all
   build_review tests use an isolated tmpdir `projectRoot`. Header note amended.

## Upstream dependencies (present on main — verified, not assumed)

- **Engine-owned task-status** (#302/#384, ADR 2026-07-05): merged (`5c73c293` on main);
  TS-5's completion-survives-kickback criteria have a live engine mechanism.
- **Generated model table** (#187, `model-table-metadata.ts`): present on main and enforced by
  integrity checks 5a/5b; TS-1's missing-row negative path has a live enforcement mechanism.

## Compatible pairs examined

`prd-audit-kickback-preserves-task-status`, `generated-model-table`, `rebase-resolution-skill`,
`retry-as-escalation`, `fresh-session-per-step`, `pr-timing configurable` (+PR #267, loopGate-
completion hook fires at build_review's boundary — benign), `conductor-test-suite-leaks`,
`auto-resolve-open-pr-conflicts`; all `origin/spec/*` branches; open PRs listed above.

## Not examined (targeted grep showed no registry/topology/config-map/verdict hits)

Daemon lifecycle/ownership/observability/intake story set (`daemon-*`, `multi-operator-*`,
`otel-observability`, `phase-9.*`, `model-availability-fallback-ladder`,
`pipeline-scope-per-task-verify-*`, intake/dedup/changelog/docs stories). If any is later found
to edit `steps.ts`/`resolved-config.ts`, re-check against the #367 and model-table pairs.
