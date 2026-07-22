# Gate-step completion validates against code state, not evidence timestamp (#817)

Status: Accepted

## Context

A re-dispatched feature re-runs completed judged gate steps (`build_review`, `prd_audit`,
`architecture_review_as_built`, `manual_test`) because their evidence is rejected by wall-clock mtime
(the freshness floor moves forward on every `Conductor.run()`), not by whether the code the verdict was
recorded against changed. These stories make gate-step completion **code-validity-gated**: a re-dispatch
preserves a passed gate whose surface is unchanged and re-runs only when something substantial changed —
while keeping every fail-closed protection. `wiring_check` (already HEAD-anchored), `acceptance_specs`
(no mtime guard — separate durability bug), and `task-status.json` build resume are explicitly out of
scope and must be unchanged. Acceptance is framed as **observable preserve-vs-re-run behavior**, proven
in both directions.

Terminology: *stamped baseline* = the HEAD SHA a verdict's `codeStamp` records; *surface* = the gate's
`GATE_SURFACE` kind; *delta* = `git diff --name-only baseline..HEAD` filtered to code/test paths.

## Story 1 — A verdict is stamped with the code state it was recorded against

As the conductor gate layer, every judged-gate verdict must record the code baseline it was formed
against, so a later re-dispatch can tell whether the verdict still reflects the current code.

### Happy Path

- **Given** a judged gate (`build_review`, `prd_audit`, `architecture_review_as_built`, `manual_test`)
  whose judge dispatch writes its verdict artifact,
- **When** the verdict is written,
- **Then** the artifact carries an additive `codeStamp` = the current HEAD SHA, alongside the existing
  verdict fields, and the existing verdict shape (verdict/reasons/rubric) is otherwise unchanged.

### Negative Path

- **Given** a project that is not a git repository (`getHeadSha()` returns null),
- **When** a verdict is written,
- **Then** no `codeStamp` is recorded (rather than a bogus value), and completion falls back to
  existing behavior — the change never fabricates a baseline.

## Story 2 — A re-dispatch preserves a passed gate whose surface is unchanged

As a re-dispatched feature, a judged gate that already passed against the current code must NOT re-run.

### Happy Path

- **Given** a `build-review.json` verdict `PASS` with a `codeStamp` whose baseline is reachable and whose
  delta to current HEAD contains no path in `build_review`'s surface (`any-codetest`),
- **When** the conductor re-dispatches and evaluates `build_review` completion (a fresh
  `session_started_at`, so the verdict's mtime predates the floor),
- **Then** the step is reported `done` with no judge dispatch — the mtime-predates-floor fact alone does
  **not** cause a re-run.

### Happy Path (feature-runtime gate)

- **Given** a `prd_audit` / `architecture_review_as_built` verdict `PASS` whose delta since its baseline
  touches only foreign runtime or test/docs paths (misses the gate's `feature-runtime` surface),
- **When** the gate's completion is re-evaluated on re-dispatch,
- **Then** it is preserved (`done`, no re-run).

### Negative Path

- **Given** the same `PASS` verdict but the delta since its baseline **does** include a path in the
  gate's surface (the feature's own runtime source changed),
- **When** completion is re-evaluated,
- **Then** the verdict is **not** preserved — the gate re-runs.

## Story 3 — Fail-closed on a missing stamp (legacy / opt-out)

As the gate layer, a verdict that carries no code baseline must never be treated as more trustworthy
than it is today.

### Happy Path

- **Given** a `PASS` verdict authored before this change (no `codeStamp`) — or the kill-switch is off,
- **When** completion is re-evaluated on re-dispatch,
- **Then** the code-validity branch does not apply and the existing mtime-freshness behavior governs
  (the verdict is re-run on resume, exactly as today) — no silent preservation of an un-stamped verdict.

## Story 4 — Fail-closed on an unreachable baseline (#766 orphan guard)

As the gate layer, a verdict whose stamped baseline no longer exists in history must re-run, never wedge.

### Happy Path

- **Given** a `PASS` verdict whose `codeStamp` baseline is unreachable (orphaned by a rebase/reset/amend,
  the #766 hazard),
- **When** completion is re-evaluated,
- **Then** the verdict is **not** preserved (the gate re-runs), and no "uncreditable-undemotable" wedge
  or operator halt is produced.

### Negative Path

- **Given** the git delta `baseline..HEAD` cannot be computed (e.g. git error),
- **When** completion is re-evaluated,
- **Then** the code-validity check fails closed to re-run (mirrors the rebase-path
  invalidate-all-on-uncomputable), never preserves.

## Story 5 — A kickback that changed code still invalidates the verdict

As the gate layer, a kickback-to-build that changes code must not let a pre-kickback verdict survive.

### Happy Path

- **Given** a `build_review` `PASS` verdict, then a kickback whose fix commits change a path in
  `build_review`'s surface,
- **When** the gate is re-evaluated,
- **Then** the delta since the stamped baseline hits the surface, so the verdict is invalidated and the
  gate re-runs (a stale pre-kickback PASS can never satisfy the gate).

### Negative Path

- **Given** a no-op kickback that changes no code under the gate's surface (e.g. only docs/CHANGELOG),
- **When** the gate is re-evaluated,
- **Then** the verdict is preserved — a no-op kickback does not force a needless re-run.

## Story 6 — The within-dispatch attempt-floor is preserved when a gate DOES re-run

As the gate layer, when a gate is re-run, the judge must still write a fresh verdict this attempt.

### Happy Path

- **Given** a gate that re-runs (surface changed / no stamp / invalidated) and the judge is dispatched,
- **When** the judge declines to rewrite its verdict file this attempt,
- **Then** the existing per-attempt freshness floor (`verdictFreshnessComparand` with its FS tolerance)
  still scores it "no fresh verdict" and loops/kicks back exactly as today — the incident-2026-07-12
  guard is intact.

## Story 7 — `sweepStaleReviewArtifacts` does not delete a still-valid verdict

As the re-entry sweep, a prior-session verdict that is still code-valid must survive so the completion
check can preserve it.

### Happy Path

- **Given** a re-entry into a swept step (`prd_audit` / `architecture_review_as_built` / `manual_test`)
  whose prior-session verdict is `PASS` with a matching, reachable, surface-unchanged `codeStamp`,
- **When** `sweepStaleReviewArtifacts` runs before the step re-evaluates,
- **Then** it does **not** delete that verdict artifact (the code-validity check spares it), and the step
  is then reported `done`.

### Negative Path

- **Given** a swept-step verdict whose baseline is unreachable / surface changed / stamp missing,
- **When** the sweep runs,
- **Then** it deletes the artifact as today (so the step re-runs honestly rather than reusing a stale
  verdict).

## Story 8 — Out-of-scope gates and task resume are unchanged

As the harness, the fix must not alter gates that already behave correctly.

### Happy Path

- **Given** `wiring_check` (already HEAD-anchored), `acceptance_specs` (no mtime guard), and
  `task-status.json` build resume,
- **When** a feature re-dispatches,
- **Then** their behavior is byte-identical to before this change — `wiring_check` still preserves on
  unchanged HEAD, `acceptance_specs` still content-validates (its RED-absence self-heal is untouched),
  and completed build tasks still resume without redo.
