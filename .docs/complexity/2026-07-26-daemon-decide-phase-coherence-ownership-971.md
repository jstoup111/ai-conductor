# Complexity: 2026-07-26-daemon-decide-phase-coherence-ownership-971

Tier: M

## Signals

| Signal | Present? | Notes |
|---|---|---|
| New data models / entities | No | No new types beyond (possibly) one boolean field on the existing `StepDefinition`. |
| External integrations | No | Nothing leaves the process. |
| Auth / security surface | No | Untouched. |
| Cross-subsystem span | **Yes** | Three production modules plus the step table: `daemon-cli.ts` (preseed/dispatch, `:285-296`, `:882-887`), `daemon-backlog.ts` (discovery vetting loop, `:655-673`, `:771`), `steps.ts` / `types/steps.ts` (step-definition seam), and the daemon-wiring integration contract whose current assertion must be **inverted**, not merely extended. |
| State machine / complex control flow | No | No new state machine; it reuses the existing warn-skip and step-status flows. |
| Architectural seam / abstraction | **Yes** | Two seam-level decisions: (a) replacing a hand-maintained dispatch constant with a derivation over `ALL_STEPS`, which changes how *every future* DECIDE step is treated; (b) the `'done'` vs `'skipped'` preseed-status semantics for tier-skippable steps, which resolves an existing internal inconsistency and sets precedent beyond this issue. Both need an APPROVED ADR. |
| Story count (est.) | 5–6 | Preseed the step; derive the list; discovery-side rejection for non-S; preserve the S exemption; invert the integration contract; plus negative paths. |

## Rationale

Raw volume leans Small — the core behavioral change is "one step name stops being executed",
and the minimal diff is a single string added to a list. This repo's practiced dividing line,
however, is not volume. Across the `.docs/complexity/` precedents surveyed, the reliable M
trigger is **"does an ADR / architectural seam have to be created or amended?"**, with
cross-subsystem span second. Compare `2026-07-03-daemon-auto-restart-stale-engine.md`, which
states its raw signals lean Small and classifies **Medium** anyway because it touches the
daemon's core lifecycle loop and needs an ADR amendment — structurally the same situation as
this change.

Both M triggers fire here:

1. **Architectural seam.** The chosen direction does not just patch the instance; it replaces a
   hand-maintained constant with a derivation over the step table (`ALL_STEPS.filter(s =>
   s.phase === 'DECIDE')`), so phase membership becomes the contract that governs daemon
   preseeding for all future steps. Separately, the `'done'` vs `'skipped'` question for an
   S-tier preseeded step resolves an inconsistency the codebase currently carries (three other
   tier-skippable DECIDE steps are already stamped `'done'` unconditionally). Neither is
   mechanical, and Small's architecture-review skip cannot produce the ADR they require.
2. **Cross-subsystem span.** Preseeding (`daemon-cli.ts`), discovery-time vetting
   (`daemon-backlog.ts`), and the step-definition table (`steps.ts`) must move together, and an
   existing integration assertion has to be inverted. A change that only edits `PRESEEDED_DONE`
   would satisfy outcome 2 while silently regressing outcome 3, so the multi-site coordination
   is required by the acceptance signals, not chosen for elegance.

Blast radius on its own would *not* have promoted this — precedent
(`build-stall-remediation-skips-no-task-progress.md`) keeps an engine-critical retry-loop edit
at S and mitigates with tests. It is the ADR need that decides it, exactly as the corpus does.

**Not Large:** no new subsystem, no schema or migration, no external integration, no auth
surface, and the story count stays well under the L threshold. Confined to the daemon dispatch
path and its step table.

## Divergence from the intake `size:` label — flagged for the operator

The issue carried **contradictory labels**: `priority: critical` + `size: S` (applied by
`jstoup111` at 2026-07-26T14:55:59–14:56:00Z) and `priority: medium` + `size: M` (applied by
`github-actions[bot]` 18s later at 14:56:18–14:56:19Z).

Resolved from evidence, not preference. `.github/workflows/intake-label-sync.yml:13` documents
that **"Unparsable/missing fields default to `priority: medium`, `size: M`"**, and
`src/conductor/scripts/intake-label-sync-apply.mts:33-51, 84-85` parses `### Priority` /
`### Size` issue-form headings. Issue #971 was filed by an agent via `gh issue create` with
`##`-level Observed/Impact/Desired outcome/Hypotheses headings and **no** Priority or Size
field, so both bot labels are unparsable-field fallbacks — not intent. The human labels are the
intentional signal. The bot labels were removed; #971 now carries `priority: critical`,
`size: S`.

This assessment nevertheless lands **Tier M**, diverging from the human `size: S` label. That
divergence is deliberate and safe:

- The GitHub `size:` label does **not** feed the build tier. Verified: the daemon resolves the
  tier from `.docs/complexity/<plan-stem>.md` (`daemon-backlog.ts:771`,
  `daemon-cli.ts:887`); the `size:` label feeds backlog *priority ordering* only
  (`backlog-priority.ts`). So there is no machinery conflict between the label and this file.
- M is the conservative direction. It runs a **superset** of gates (architecture-diagram,
  architecture-review + ADR, conflict-check, coherence-check all execute; at BUILD, nothing is
  skipped). Choosing S would skip architecture-review and leave the two seam decisions above
  unresolved — that would be the option that builds on an unconfirmed assumption.
- Repo precedent records operator confirmation on borderline tier calls ("Operator confirmed
  MEDIUM on 2026-07-03"; "Operator-confirmed Tier S in the 2026-07-22 engineer session"). This
  call was made autonomously, so it is flagged here rather than silently taken. **If the
  operator prefers S, the correction is to re-run DECIDE at S; the artifacts produced at M are
  a superset and nothing is lost.**

## Tier-driven step consequences

At M: `/architecture-diagram`, `/architecture-review` (lightweight), `/conflict-check`, and
`/coherence-check` all run. `/prd` is skipped (technical track). At BUILD the daemon skips
nothing for M. The land-time coherence gate engages fail-closed, so this spec must itself
carry a valid `.docs/coherence/2026-07-26-daemon-decide-phase-coherence-ownership-971.md` —
fittingly, the very artifact whose ownership this issue is about.
