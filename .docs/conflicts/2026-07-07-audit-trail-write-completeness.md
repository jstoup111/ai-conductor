# Conflict Check: audit-trail-write-completeness-for-retro-under-fre

**Date:** 2026-07-07
**Stories checked:** `audit-trail-write-completeness-for-retro-under-fre.md` (7 technical stories)
**Comparison set:** all `.docs/stories/` (full reads of otel-observability, wave-c pair,
decide-pipeline-restructure, daemon-event-driven-wake, operator-park, halt-pr-presentation-
reliability, phase-9.1-retro-signal, conductor-test-suite-leaks, pipeline-scope-per-task,
daemon-logs-surface-kickback, retry-as-escalation; targeted reads of features/pipeline
ST-020, features/code-review ST-021, features/conduct ST-006, features/retro ST-024) +
prior reports in `.docs/conflicts/`.

**Result:** 0 blocking, 6 degrading — all resolved by story amendment (operator-accepted
2026-07-07). No ADR superseded.

## Resolved degrading conflicts

### 1. `halt_cleared` as a new bus event vs event-union tests/fixtures
**vs:** `otel-observability.md:31-42` (byte-identical events.jsonl, no-emission-edit
assert), `wave-c-telemetry-event-log.md:192-193` (union validity). **Type:** contradiction
(fixture/schema). **Resolution:** `halt_cleared` IS a first-class `ConductorEvent`; the
union-validity test and golden fixtures are updated in the same diff. OTel's invariant
bound that feature's own diff, not all future emissions. Story 5 amended.

### 2. Retro's retry-escalation source
**vs:** `retry-as-escalation.md:45-55` (Story 4: `escalatedModel`/`escalatedEffort`
persisted to raw `.pipeline/events.jsonl` for retro Part C). **Type:** behavioral overlap.
**Resolution:** raw events.jsonl remains retro's escalation source; the audit trail is
additive (gate/friction history), never a replacement. Story 7 amended.

### 3. `.pipeline/audit-trail/` directory is pre-existing shared space
**vs:** `features/pipeline/ST-020:37`, `features/code-review/ST-021:19`
(`code-review-satisfied.md`, `batch-N/`). **Type:** resource contention. **Resolution:**
idempotent mkdir; disjoint filenames; writer never touches/wipes batch artifacts. Story 1
amended.

### 4. Autonomous rekick rename fires the same clear watcher
**vs:** `daemon-event-driven-wake…:24-26` (`HALT` → `HALT.cleared` rename fires watcher
same as removal; same pattern in operator-park:159, sandbox-auth-expiry-park:154).
**Type:** state/attribution. **Resolution:** `halt_cleared` record carries
`cause: 'operator'` (plain unlink) vs `cause: 'rekick'` (`HALT.cleared` sibling present) —
retro never misattributes an autonomous clear as operator intervention. Story 5 amended.

### 5. Watcher-disposal / worktree-teardown sequencing
**vs:** `daemon-event-driven-wake…:89-98` (watcher disposed before teardown; no-op dispose
on missing dir must not throw). **Type:** sequencing. **Resolution:** already covered by
Story 5's loud-failure negative path; plan constraint: append is synchronous within the
callback and must preserve the watcher's no-throw contract. No story change needed beyond
the existing negative path.

### 6. cwd-`.pipeline` leak guard binds the writer's path derivation
**vs:** `conductor-test-suite-leaks…:20-22,88-91` (global teardown fails the run on
cwd-relative `.pipeline` writes). **Type:** constraint. **Resolution:** writer paths root
at the injected worktree/projectRoot, never `process.cwd()` — added as an explicit Story 1
acceptance criterion.

## Notes (no action)

- Precedent `2026-06-28-clean-check.md` already ruled additive bus listeners + distinct
  sinks safe (multicast emitter; EventPersister/otel.jsonl/audit-trail events.jsonl are
  disjoint files). Carry-over constraint: emit() awaits handlers — the audit append is a
  small sync write and must stay off any slow path.
- `phase-9.1-retro-signal` reads the RAW `.pipeline/events.jsonl` — parallel consumer,
  different file; naming-hygiene note only (two "events.jsonl" now exist).
- `.pipeline/` is gitignored/ephemeral (`decide-pipeline-restructure.md:11-18`) — new
  writes cannot dirty the tree or trip ship guards.
- No exclusivity assertion found on `.pipeline/gates/`; audit records complement, never
  replace, gate verdicts.
- Remote `spec/*` branch stems checked at name level: no collision with this feature.
