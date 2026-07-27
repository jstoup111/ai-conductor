# Conflict Check: daemon-mode DECIDE kickback guard (#551)

**Date:** 2026-07-27
**Stories:** `.docs/stories/daemon-mode-kickbacks-route-human-judgment-gaps-in.md` (S1–S7)
**Verdict:** **CLEAN** — 4 conflicts found, all resolved in the stories/ADR before this report closed.

## Method

Each story pair checked for contradiction, overlap, state conflict and resource contention; then
each story checked against already-shipped behavior in the same code region (the tail gate loop,
the remediation planner, the rekick sweep) and against the two sibling open issues (#550, #989).

## Resolved conflicts

### C1 — S1 (halt on DECIDE kickback) vs S4 (cap keeps precedence) — **state conflict**
Both stories claim the HALT for the same situation: a DECIDE-targeted kickback that has also
exceeded `MAX_KICKBACKS_PER_GATE`. Two different reason strings and, potentially, two different
halt classes would be produced depending on evaluation order.
**Resolved:** the ADR fixes a single order — counter bump → `kickback` event → cap check → phase
check → `navigateBack`. The cap wins when both apply. S4's happy path asserts exactly that; S1's
criteria are scoped to the below-cap case.

### C2 — S1 vs S3 (interactive unchanged) — **contradiction at the front-half call site**
S1 asks the guard to fire wherever a DECIDE kickback is detected; S3 asks front-half amendment
kickbacks to be untouched. `scanKickbackVerdicts` is called from both the front half
(`conductor.ts:6420`, `navigate:false`) and the tail (`:6473`, `navigate:true`), so an unqualified
reading of the two stories is contradictory.
**Resolved:** the discriminator is `daemon`, not the call site. S3's scope is *interactive*
front-half kickbacks (unchanged); S3's own negative path states that the same front-half path
**does** halt when `daemon: true`. Architecture review F6 records the reasoning.

### C3 — S6 (refactor `planRemediation`) vs shipped #647 D1 / halt-wins ordering — **overlap**
`planRemediation` already contains three ordered decisions in the same few lines: halt-gaps win
over routable fixes (`conductor.ts:1706-1713`), the #644 phase check (`:1722-1737`), and the D1
route-into-no-op guard (`:1738-1760`). A careless extraction could reorder them and silently
change which halt a run reports.
**Resolved:** S6 is explicitly a *behavior-preserving* refactor — same detail text, same return
shape, same relative order — and pins its proof to two existing suites passing unmodified
(`conductor-remediation-noop-guard.test.ts`, `kickback-build-noop-escalation.acceptance.test.ts`).

### C4 — S5 (`needs-human`, never auto-cleared) vs the daemon's throughput expectation — **resource contention**
A `needs-human` HALT is skipped by `rekickSweep` on every sweep forever
(`daemon-rekick.ts:173-193`). A feature that trips this guard therefore occupies a worktree and a
backlog slot indefinitely until an operator acts — in contrast with mechanical halts, which
self-clear.
**Resolved:** accepted deliberately, and it is the whole point of the issue ("any gap that
requires human judgement must surface as a HALT the operator resolves"). The cost is bounded by
the existing halt-surfacing machinery — `surfaceRemediationPr` opens a PR and the halt-issues
sweep files/stamps an issue — so the feature is visible on the dashboard rather than silently
parked. Recorded in the ADR's Consequences.

## Checked, no conflict

- **vs #550 (forward-walk guard).** Different seam: #550 governs the daemon's *forward* dispatch
  of DECIDE steps via the `PRESEEDED_DONE` status preseed in `daemon-cli.ts`; this feature governs
  *backward* navigation in the engine loop. They can land in either order. If #550 lands first,
  nothing here changes — `navigateBack` resets the preseeded status to `pending` regardless, which
  is precisely why the backward guard is needed separately.
- **vs #989 (per-run kickback counters reset each dispatch).** Orthogonal: #989 is about the cap
  counter's lifetime, this is about which target the cap-surviving kickback may reach. A daemon
  DECIDE kickback now halts on the *first* occurrence, so the counter's lifetime does not affect
  the new path at all.
- **vs #532 (verdict-aware resume).** Complementary and required by S5's resume criterion — the
  clamp is what makes "resume without re-walking" true after a human clears the halt. No competing
  claim over the resume entry index; this feature adds no resume logic.
- **S2 vs S1 target sets.** Disjoint by construction — DECIDE vs everything else, both derived
  from the same `steps` table, so no step can satisfy both.
- **S7 (docs) vs everything.** No behavioral claim; touches `docs/explanation/gates.md` and
  `CHANGELOG.md` only, neither of which any other story writes.
- **File contention across stories.** S1/S4 write `scanKickbackVerdicts`; S6 writes
  `planRemediation`; both are in `conductor.ts` but in non-adjacent regions (~6189 vs ~1655), and
  S2/S5 add no production edits of their own beyond the shared predicate module. Sequencing in the
  plan puts the predicate first so both call sites consume a stable signature.

## Residual risk

None blocking. The one judgement call — that a DECIDE-kickback halt should be permanent rather
than retried — is deliberate, documented in the ADR, and reversible by changing one argument to
`writeHaltMarker`.
