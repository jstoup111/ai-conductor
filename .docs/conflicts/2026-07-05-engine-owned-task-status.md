# Conflict Report: engine-owned task-status.json (#302)

**Date:** 2026-07-05
**New stories:** `.docs/stories/prd-audit-kickback-preserves-task-status.md`
**Scanned against:** all `.docs/stories/` (including `features/`), open #280, closed #115,
`daemon-rekick.ts` FR-9, the `/pipeline` `/tdd` `/remediate` `/finish` contract changes, and the
`post-commit-pipeline-sync.sh` hook removal.
**Result:** 1 blocking conflict (resolved), 1 degrading overlap (accepted by design), 2 benign
overlaps (noted). Re-check clean — zero blocking conflicts remain.

## Conflict: Pipeline agent as task-status writer (RESOLVED)

**Stories involved:** "Pipeline Factory Orchestration" (ST-020) vs the new single-authority
stories (H4/H6).
**Files:** `.docs/stories/features/pipeline/ST-020-factory-orchestration.md` vs
`.docs/stories/prd-audit-kickback-preserves-task-status.md`
**Type:** contradiction (resource-contention on the `task-status.json` write authority)
**Severity:** blocking

**Description:** ST-020's happy path asserts the pipeline records task status
"in `.pipeline/task-status.json` as `completed`" and its pre-completion scan writes
`pre-completed` — the exact agent-authority the APPROVED
`adr-2026-07-05-engine-owned-task-status.md` removes (H4: `completed`/`skipped` engine-only;
H5: pre-completed/skipped move to no-op `Evidence:` commits).

**Resolution applied (option 1, least disruptive):** ST-020 amended in place with a supersession
note pointing at the ADR + new stories; its agent-write criteria are marked as the superseded
pre-2026-07-05 contract. No new ADR needed — the architectural decision is already recorded and
APPROVED; this is story-text reconciliation. The root lives in the (approved) design change, not
in a design gap, so no kickback.

## Overlap: park-marker provenance (DEGRADING — accepted)

**Stories involved:** "Operator parks a feature by slug" family (operator-park stories, which
assume marker body "parked by operator") vs "No evidence after N attempts parks the feature."
**Type:** behavioral overlap on the `.daemon/parked/<slug>` marker family
**Severity:** degrading (accepted)

**Description:** `park-marker.ts` today writes a fixed "parked by operator" body; the auto-park
reuses the marker *family* with a distinct machine provenance. Existence-based consumers
(`rekickSweep` skip, `unpark` verb, stale-park listing) are unaffected; the dashboard grouping
must read provenance instead of assuming operator origin. The operator-park story "Machine-placed
halts keep today's re-kick behavior" (FR-5) is about `.pipeline/HALT` lifecycles and is untouched
— the auto-park is a park marker, not a HALT.

**Acceptance rationale:** the new Slice-3 story explicitly requires distinct provenance,
provenance-aware dashboard rendering, and a logged event; the operator-park stories' guarantees
(operator marker survives everything, byte-identical sweep when nothing is parked) remain intact.

## Noted: #280 forward-progress park (sequencing overlap, non-blocking)

#280 (OPEN, no landed spec) wants the daemon to recognize forward progress in multi-dispatch
builds. The new durable no-evidence counter (H7) — reset on any completed-count increase — IS the
forward-progress delta #280 needs, and the ADR scopes the auto-park as the no-evidence trigger of
that shared mechanism, not a competitor. This spec implements first; #280's eventual spec must
build on the sidecar counter (recorded in the ADR's Consequences).

## Noted: event-driven wake for parked features (compatible, non-blocking)

The wake feature re-dispatches on HALT clear / parked-set changes. Auto-park unpark flows through
the same `unpark` verb + watcher surface as operator unpark, so resume-on-unpark composes with the
wake mechanism without new wiring. The Slice-3 story's unpark criterion covers it.

## Re-check

After the ST-020 amendment: contradiction cleared; no pair of stories asserts conflicting
authority over `task-status.json`; no impossible states (park vs re-kick semantics are
existence-based and consistent); no circular sequencing (slices are ordered 1→3; #280 explicitly
downstream). **Conflict check passed.**
