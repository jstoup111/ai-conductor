# Complexity: No-diff task evidence stamp — deterministic completion currency for verification/skip tasks (#733)

**Issue:** #733 — "Build stall no_task_progress (N→N) on no-diff verification/skip tasks — auto-parked after 3 attempts (5 of 6 batch builds)"
**Plan stem:** `no-diff-task-evidence-stamp`
**Relates to:** #677 (verify-only judged-closure lane / `adr-2026-07-17-verify-only-judged-closure`), #707 (bounded-dirname corroboration), #463 (evidenceStamps is the only completion currency), #188 (retry escalation ladder).

Tier: M

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | None. Reuses the existing `evidenceStamps` sidecar and its `form` discriminator; adds one new form value (`evidence:skipped`). No task-status/plan schema change. |
| Integrations | Two existing seams, both in `autoheal.ts`: `deriveCompletionInternal`'s `Evidence: skipped` branch, and `parsePlanTaskVerifyOnly`. The change propagates unchanged into its two current consumers (the lane arming in `conductor.ts`, the path-relaxation in `attribution-lane.ts`) with no edit to either. |
| Auth / secrets | None. |
| State machines | None. Both edits are pure, stateless derivations from git evidence + plan text. |
| Story count | 6 stories: 2 happy-path (skip stamp; verification-type arming), 3 load-bearing negative-path (self-reported skip with no commit still un-stamped; forged/non-ancestor citation on a verification task still refused; non-"verification" Type stays fail-closed), 1 end-to-end acceptance replaying the #733 stall shape. |
| Blast radius | The completion-evidence gate only. `countResolvedTasks`, task-status seeding, and the `satisfied-by`/trailer/dirname stamping paths are untouched; a story guards that the derive-from-git invariant is preserved. |

## Why M (not S, not L)

- **Not S:** it changes a **captured design decision** — what currency the build gate
  accepts as "resolved" (#463 made `evidenceStamps` the sole currency; this widens
  *how* a no-diff task earns one) — and it **widens the judged-closure lane's
  eligibility** beyond the explicit `**Verify-only:** yes` marker that
  `adr-2026-07-17-verify-only-judged-closure` deliberately scoped. Both are
  architectural choices that must be recorded in an ADR and conflict-checked against
  #677/#707/#463 so a whitewash regression is not reintroduced. Small would skip both.
- **Not L:** no data model, no state machine, no new service, no new hook wiring, no
  `settings.json`/`bin/conduct` CLI change. The change is two functions in one file plus
  tests and docs.

## Tier consequences (per engineer skill)

- `/architecture-diagram`: present (lightweight) — `.docs/architecture/no-diff-task-evidence-stamp.md`.
- `/architecture-review`: lightweight, one ADR — `.docs/decisions/adr-2026-07-21-no-diff-task-evidence-stamp.md` (APPROVED before land).
- `/conflict-check`: present — `.docs/conflicts/no-diff-task-evidence-stamp.md` (reconciles with #677/#707/#463).
- `/prd`: skipped (technical track — acceptance criteria live in the stories).
