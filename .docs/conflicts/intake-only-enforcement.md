# Conflict check: intake-only-enforcement (#695)

**Stem:** `intake-only-enforcement` · **Tier:** M

## In-flight work scanned

- **PR #696 — `intake-criteria-enforcement` (#695, prior engineer session).**
  Direct overlap: same issue, same problem. **This spec supersedes it.** Its files
  (`.docs/plans|stories/2026-07-20-intake-criteria-enforcement.md`) live only on the
  #696 branch, never on `main`, so there is no on-`main` file collision. The two
  must not both merge. Resolution: this PR body states it supersedes #696; the
  operator closes #696. Flagged in the report for operator action.
- **`backlog-priority.ts` (`parsePriorityLabels`, banding, `IssueLabelReader`).**
  Both specs add `parseSizeLabel` beside `parsePriorityLabels`. This spec adds only
  the pure parser (Story 5) — it does **not** wire a criteria reader into
  `createPriorityResolver`/`claimUnblocked` (that was #696's downstream gate). No
  conflict with banding.
- **`dependency-claim.ts` / `ClaimOutcome`.** #696 adds a `needs-criteria` variant
  and a claim-time deferral here. **This spec deliberately leaves this file
  byte-identical to `main`** and Story 6 asserts that. The conflict is a *design*
  conflict, resolved by the ADR in favour of intake-only; there is no code overlap
  from this spec.
- **`.github/ISSUE_TEMPLATE/intake.yml`.** Touched here (adds required Priority/Size
  selects + Depends-on). No other in-flight spec edits it. Integrity check #11
  ("Issue-template YAML validity and blank-issues guard") must stay green.
- **`.github/workflows/`.** Adds `intake-label-sync.yml`. `ci.yml` and `release.yml`
  are **not** modified — the new Action is isolated and labels-only, so it cannot
  interact with the release/version gates.
- **`skills/intake/SKILL.md`.** §7/§8 updated to route through `bin/intake-file`.
  No other in-flight spec touches the intake skill. Cross-skill/template ref
  integrity checks must stay green after the edit.

## Divergence from #696 (the reconciliation)

| Dimension | #696 (superseded) | This spec (#695, directive-compliant) |
|-----------|-------------------|----------------------------------------|
| Enforcement location | claim time (`claimUnblocked` defers) | capture/file time (born complete) |
| New downstream state | `needs-criteria` outcome + `intake:needs-triage` flag | **none** |
| Backfill | HALT / per-issue operator confirmation | default-and-report, no HALT |
| `dependency-claim.ts` | modified | **unchanged** (asserted, Story 6) |
| Directive fit | violates "no failures downstream" | complies |

## Verdict

No on-`main` file conflict. The only conflict is the **competing #696 spec**, which
this supersedes by design (ADR-recorded). Safe to build once #696 is closed. No
migration/version interaction (labels + additive form fields + new isolated Action).
