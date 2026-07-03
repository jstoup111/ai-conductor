# Architecture Review: harness-daemon-profile (build-to-PR enablement, #174)

**Date:** 2026-07-03
**Mode:** Lightweight (Tier M) — feasibility + alignment
**Inputs reviewed:** .docs/track/harness-daemon-profile.md, .docs/complexity/harness-daemon-profile.md,
.docs/architecture/2026-07-03-harness-daemon-profile.md (approved)
**Verdict:** APPROVED

## Feasibility

| Item | Assessment |
|---|---|
| `bin/setup` | Trivially feasible. `prepareWorktree` (worktree-prepare.ts:89-118) already invokes a repo-root `bin/setup` with `CI=true` + `WORKTREE_NAMESPACE` when present; non-zero exit keeps the worktree and errors the feature. The script is pure npm: `npm install && npm run build` in `src/conductor`. tsup outputs to the worktree-local `dist/` — no shared state touched during daemon builds. |
| Semver escalation | Feasible with existing plumbing. `runSelfHostFinishGates` (conductor.ts:552) already computes `selfBuildChangedFiles()` (`git diff --name-status <base>...HEAD`, null → fail-closed) for the release gate; the same thunk threads into `versionGate` (wiring.ts bundle + conductor.ts:556-560 call site). Classifier is a pure function over the existing `ChangedFile[]` shape (release-gate.ts:152-164), reusing `classifyBreakingSurfaces` (release-gate.ts:180, tested) for MAJOR surfaces. No new external deps, no schema changes, no migrations. |
| Docs reconciliation | Text-only edits to README.md (retire "cutover MUST NOT be set on harness" at ~434/443-444, update §self-host status + escalation table) and src/conductor/README.md (daemon-on-harness note). |
| Prerequisites | None missing — repo already daemon-registered (committed .ai-conductor/config.yml, cutover 2026-07-02T11:00:00Z); self-host guardrails Phase 6 wiring is on main. |

## Alignment

- **HALT-based, fail-closed doctrine** (adr-2026-06-30-halt-based-release-gates): preserved.
  The only refinement — PATCH auto-pass — is scoped to provably-patch change sets; every
  uncertain, unclassified, or signal-bearing case still HALTs. Recorded as an explicit
  amendment (adr-2026-07-03-version-gate-semver-escalation, Amends header) rather than silent
  drift.
- **Non-autonomy** (adr-005, adr-010): untouched — daemon still never merges, never edits
  VERSION. Restated as a property of the profile.
- **Pattern consistency:** `bin/setup` uses the existing worktree-prep convention (no new engine
  seam); the classifier mirrors `classifyBreakingSurfaces`'s pure-function-over-ChangedFile
  pattern; gate verdicts keep the `GateVerdict` shape and distinct HALT reasons.
- **Marker override invariance:** `.pipeline/version-approval` semantics unchanged in both
  directions — the operator's manual path survives intact.
- **Worktree isolation:** no new ports/DBs/services; npm install is per-worktree (each worktree
  needs its own `node_modules`, consistent with existing practice).
- **Diagram accuracy:** 2026-07-03-harness-daemon-profile.md reflects the attach points;
  change-log entry added to 2026-06-30-harness-self-host-guardrails.md.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| PATCH allow-list too permissive — a semver-significant change auto-passes | Technical | Low | Medium | Conservative fail-closed allow-list; `.pipeline/version-signal.json` audit trail; human reviews every PR before merge |
| Self-referential test blind spot (gate bug ships green, runs as builder post-install) | Technical | Low | High | Accepted residual risk per adr-2026-07-03-harness-daemon-profile; human review-before-merge; no auto-merge |
| Human runs `bin/setup` in the primary checkout → shared-dist rebuild (`clean: true`) ENOENT-crashes running daemons (#215) | Integration | Medium | Medium | Docs state the script is worktree-prep; real fix tracked in #215 |
| Allow-list drifts as repo layout changes (e.g. planned bin/conduct removal) | Knowledge | Medium | Low | Escalation table documented in README; classifier unit tests break loudly on surface changes |

## ADRs Created

- `adr-2026-07-03-harness-daemon-profile.md` — the profile decision, residual risk, rejected
  runtime-file guard, tribal-rule retirement. (DRAFT → pending operator approval)
- `adr-2026-07-03-version-gate-semver-escalation.md` — escalation taxonomy; amends the
  VersionApprovalGate sub-decision of adr-2026-06-30-halt-based-release-gates. (DRAFT →
  pending operator approval)

## Conditions

None — APPROVED, contingent only on the two ADRs reaching APPROVED status before stories
(§7b hard gate).
