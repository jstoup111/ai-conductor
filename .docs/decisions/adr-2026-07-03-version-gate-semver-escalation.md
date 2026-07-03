# ADR: Version-gate semver escalation — PATCH auto-pass, MINOR/MAJOR HALT

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for jstoup111/ai-conductor#174
**Amends:** adr-2026-06-30-halt-based-release-gates (the VersionApprovalGate sub-decision only;
all other gates and the HALT-based/fail-closed doctrine are untouched)

## Context

`VersionApprovalGate` (version-gate.ts) currently HALTs every self-build whose
`.pipeline/version-approval` marker is absent — including pure PATCH-class changes where CI
already cuts the patch bump on merge and no human semver decision exists to make. In practice
the operator resolves each of these HALTs by writing the current VERSION to the marker: a
ritual that adds latency and zero judgment. Meanwhile CLAUDE.md's semver rules DO require a
human decision for MINOR (new skill/hook/gate, additive HARNESS.md rule) and MAJOR (breaking
skill contract / CLI / settings schema) — and the daemon must never silently mislabel a
breaking change as a patch (issue #174).

The finish gates already possess the build's change set: `selfBuildChangedFiles()` in
conductor.ts (`git diff --name-status <base>...HEAD`, null when undeterminable) feeds
`classifyBreakingSurfaces` for the migration-block gate (release-gate.ts:180 — tested behavior).

## Options Considered

### Option A: Keep HALT-on-every-build (status quo)
- **Pros:** Maximally conservative; zero classifier code.
- **Cons:** Trains the operator to rubber-stamp HALTs (alarm fatigue erodes the gate's value);
  every patch-class daemon build parks until a human touches a marker file.

### Option B: Classify the change set; auto-pass only provable PATCH (chosen)
- **Pros:** Human decisions reserved for real semver forks; fail-closed default preserves the
  doctrine; reuses the existing change-set plumbing and `ChangedFile` shape.
- **Cons:** The PATCH allow-list is policy encoded in code and must be maintained; a wrong
  allow-list entry could let a mislabeled change auto-pass (bounded by human PR review).

### Option C: LLM-judged semver classification
- **Pros:** Handles semantic cases (e.g. "is this HARNESS.md edit additive?").
- **Cons:** Non-deterministic gate on the release path; unverifiable; rejected.

## Decision

Extend `VersionApprovalGate` with a pure, deterministic `classifyVersionSignal(changed)` step,
evaluated ONLY when no approval marker is present (the marker path is unchanged in both
directions: marker==VERSION passes, marker≠VERSION HALTs):

1. **Change set undeterminable** (`null` diff, unknown base) → **HALT** (fail-closed), reason
   names the failure.
2. **MAJOR signal** → **HALT** naming the surface and files. Signals: the existing
   `classifyBreakingSurfaces` surfaces — `bin/conduct` CLI, `bin/install`/skill symlink
   targets (delete/rename under `skills/`), hook wiring **modifications/removals**,
   `settings.json` schema.
3. **MINOR signal** → **HALT** naming the signal and files. Signals (additive-only, per
   CLAUDE.md semver rules): **added** `skills/*/SKILL.md`, **added** file under `hooks/`,
   **any change** to `HARNESS.md` (additivity of a rule edit is not machine-decidable →
   escalate), **added** gate/step registration in `src/conductor/src/engine/self-host/` or
   `steps.ts` (detected as added files; modified engine files fall to rule 4).
4. **Everything else must prove PATCH** — every changed path must match a conservative
   PATCH-safe allow-list (docs: `*.md` outside `skills/`+`HARNESS.md`, `.docs/**`, `.github/**`,
   `test/**`, `src/conductor/**` source edits that are **modifications** (not adds of new
   engine gate files), `templates/**` modifications). Any path outside the allow-list →
   **HALT** (fail-closed, treated as an unclassified signal).
5. On PATCH auto-pass the gate records its verdict + the classified file list to
   `.pipeline/version-signal.json` (run evidence, gitignored) so the PR reviewer can audit
   what auto-passed.

The HALT reason always states the classified level, the triggering files, and the resume
procedure (set VERSION per CLAUDE.md rule 4 or write `.pipeline/version-approval`). The daemon
still never edits `VERSION` and never invents a bump — auto-pass merely acknowledges that for
patch-class changes CI owns the bump.

Precedence note: a change set touching both MINOR and MAJOR signals reports MAJOR (the HALT
lists all signals found). Exact allow-list globs are finalized in the implementation plan and
covered by negative-path tests at every boundary (adversarial inputs: renamed skill, deleted
hook, HARNESS.md one-line edit, new engine gate file, mixed patch+minor change set).

## Consequences

### Positive
- Patch-class daemon builds flow to PR without a human marker ritual; the marker override
  remains for exceptional cases.
- MINOR/MAJOR HALTs become rare and meaningful — restoring the gate's signal value.
- Classifier is pure over the existing `ChangedFile[]`, unit-testable, no new plumbing.

### Negative
- The allow-list is semver policy frozen into code; it must evolve with the repo layout
  (e.g. the planned bin/conduct removal for conduct-ts will change MAJOR surfaces).
- "Modified skill" auto-passes as PATCH even though a contract-breaking SKILL.md edit is
  MAJOR by CLAUDE.md — machine-undecidable; accepted because the human reviews the PR before
  merge (same residual-risk posture as adr-2026-07-03-harness-daemon-profile).

### Follow-up Actions
- [ ] Implement `classifyVersionSignal` + gate wiring (`changedFiles` thunk threaded into
      `versionGate` in conductor.ts / wiring.ts).
- [ ] Negative-path tests at every call-site boundary with real adversarial change sets.
- [ ] Document the escalation table in README §self-host guardrails.
