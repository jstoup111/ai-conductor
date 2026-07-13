# Complexity: Classify step-failures rerun-vs-route (#646)

Tier: M

## Rationale

Small-M. One deterministic classifier applied at one existing seam, reusing signals and routing the
engine already ships — but it spans four files (predicate facet, classifier, config kill-switch,
audit event) and must interlock carefully with three merged/queued neighbours (#644, #648, #649), so
it is M rather than S.

- **The routing already exists — we only change WHEN it engages.** Route-class failures already flow
  through `planRemediation` → `earliestRemediationTarget` → the per-step kickback loops at
  `step_failed` (`conductor.ts:2927` prd_audit, `:3069` as-built/finish). The spec does **not** add a
  routing mechanism; it moves the rerun-vs-route decision earlier — from "after the retry budget
  drains" to "before the next retry burns" — by generalizing the existing prd_audit short-circuit
  (`conductor.ts:2128`).
- **The precedent is one file over.** `prd_audit` already breaks its retry loop on a fresh blocking
  report via `classifyPrdAuditGaps` (`conductor.ts:2128`, `artifacts.ts:1652`). The classifier
  reuses that exact call for prd_audit and adds the equivalent fresh-adverse-verdict signal for
  `architecture_review_as_built` and `build_review`, whose predicates already compute the
  fresh-vs-absent / adverse-vs-clean distinction (`artifacts.ts:1014`, `:1058`).
- **The input-unchanged signal reuses recorded state.** HEAD sha via `currentCommitSha` (already
  imported and called in-loop), verdict-artifact mtime via `STEP_ARTIFACT_GLOBS[step]`, and the
  prior attempt's `completion.reason` held in a loop-scoped variable. No new persistence.
- **Kill-switch is a copy of an existing block.** `retry_routing.enabled` mirrors
  `build_progress_halt` exactly (validate/resolve/defaults in `config.ts`, type in
  `types/config.ts`), including the "enabled: false is an exact revert" semantics.
- **Audit event is one union arm.** `retry_decision` added to `types/events.ts` alongside
  `step_retry`.

## What keeps it M and not L

- **Build step is out of scope** — its retry/progress accounting is #280's; the classifier never fires
  signal (a) or (b) on `build`, so nothing in the progress-aware budget path is perturbed.
- **No new artifact, no skill-contract change, no derivation change** (`autoheal.ts` untouched).
- **Compose, don't duplicate** — DECIDE-target routes still HALT via #644; kickback re-entry still
  guarded by #648; the classifier only decides rerun-vs-route.

## Sizing signals

- Files touched: `artifacts.ts` (facet + classifier helper), `conductor.ts` (seam generalization +
  capture + event emit + halt-reason threading), `config.ts` + `types/config.ts` (kill-switch),
  `types/events.ts` (event), plus README/CHANGELOG.
- Net-new deterministic logic; no I/O beyond existing sha/mtime reads.
- 5 RED-first tasks.
