# Conflict Check: a bound build_review re-raise of a resolved action case routes a judged residual gap to BUILD under the lineage limit (#3362)

**Date:** 2026-10-28
**Stories checked:** `.docs/stories/build-review-halts-as-regression-when-a-repair-lef.md` (Stories 1–3). They were checked against every story file that mentions `existingCaseId` bindings of resolved cases, the regression or repeat halts, recurrence lineage, carry, or the remediate case contract:
- read in full: `a-recurring-concern-at-a-resolved-anchor-escapes-i` (#3124), `build-review-halts-when-a-judgement-re-raises-a-so` (#3292), `build-review-halts-needs-human-when-the-judge-reje` (#3461, landed, unbuilt);
- read where they overlapped: `operator-acceptance-survives-a-build-review-re-rai` (#3271), `build-review-rubrics-need-a-post-join-adjudicator-` (#2033), `projects-cannot-add-portable-non-competing-build-r` (#1986), `build-review-re-raises-already-decided-findings-ev` (#3294), `refuted-build-review-finding-cycles-to-a-needs-hum` (#2409), `build-review-remediate-context-grows-with-the-whol` (#3291).

**Result:** clean after resolution. No blocking conflicts remain. Five contradictions with the old "every explicit `act` rebind of a resolved action case halts as a regression" rule were found and resolved by replacing the superseded assertions in place in five on-main story files (committed before land). No degrading conflict was accepted.

## ADR corpus

- **Examined:**
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` (D3, D5 and its D5.4–D5.11 amendments; amended 2026-10-28 by this spec with D5.12–D5.15);
  - `adr-2026-08-29-build-review-remediate-case-adjudication` (D7 and its 2026-10-19 and 2026-10-23 notes). It is superseded, but its D7 regression halt is still referenced by the successor, so it was retained for comparison. Its notes say explicit rebinds keep the regression halt; the successor's D5.13 amendment now narrows that for a residual or undeclared rebind of an applied action case, and the successor is authoritative;
  - `adr-2026-10-20-operator-acceptance-is-durable-case-state` (D3, carry before any regression rule): compatible, since carry is still classified first (this spec's Story 2 negative path 5);
  - `adr-2026-10-24-lap-monotonic-build-review-scope` (D7, provenance recurrence): compatible, since an unbound row still uses exact or provenance owners (Story 3 negative path 3);
  - `adr-2026-09-10-portable-build-review-policy` (D9 mechanical validation, as amended by #3461): compatible, since `reRaise` is validated by dropping, never by a new rejection, and a bound `act` row on a resolved applied action case stays bindable.
- **Narrowed out (no overlap with case bindings, recurrence or the regression halt):** the remaining approved ADRs, including restack, routing, release, OTEL, model-policy, prd-audit, tmux and intake decisions.
- **Excluded as fully superseded:** none.

## Contradictions (resolved)

### Conflict: #3124 keeps the explicit-rebind regression halt for every resolved R
**Stories involved:** Story 2 (happy paths 1 and 3) vs `a-recurring-concern-at-a-resolved-anchor-escapes-i` Story 2, negative path 3 and its Done When.
**Files:** `.docs/stories/build-review-halts-as-regression-when-a-repair-lef.md` vs `.docs/stories/a-recurring-concern-at-a-resolved-anchor-escapes-i.md`
**Type:** contradiction. **Severity:** blocking until resolved.
**Description:** #3124 said a judgement that binds S to resolved, applied R with disposition `act` "still halts `semantic remediation case regression R` and no new case is persisted", and that existing regression tests pass unchanged. This spec mints a new case for that binding when it is declared `residual-gap` or undeclared.
**Resolution:** The criterion now halts only for a declared `repeat` and states that a residual or undeclared binding is a residual rebind under the same lineage limit. The Done When now names the declared-repeat regression test.

### Conflict: #3292 halts every act rebind of a failed or applied resolved case
**Stories involved:** Story 2 vs `build-review-halts-when-a-judgement-re-raises-a-so` Story 3, negative path 2 and its Done When.
**Files:** `.docs/stories/build-review-halts-as-regression-when-a-repair-lef.md` vs `.docs/stories/build-review-halts-when-a-judgement-re-raises-a-so.md`
**Type:** contradiction. **Severity:** blocking until resolved.
**Description:** #3292 said R "failed or applied" bound with `act` halts as a regression and persists no new case.
**Resolution:** The criterion keeps the halt for a failed effect or a declared `repeat`, and states that an applied R bound with `residual-gap` or no `reRaise` gets a new case under the lineage limit. This matches this spec's Story 3 negative path 1 (`case-X`).

### Conflict: #3271 halts every non-carried act rebind of an applied or failed resolved case
**Stories involved:** Story 2 vs `operator-acceptance-survives-a-build-review-re-rai` Story 1, negative path 1.
**Files:** `.docs/stories/build-review-halts-as-regression-when-a-repair-lef.md` vs `.docs/stories/operator-acceptance-survives-a-build-review-re-rai.md`
**Type:** contradiction. **Severity:** blocking until resolved.
**Description:** #3271 said resolved C with an `applied` or `failed` effect and no acceptance halts as a regression "exactly as today" when bound with `act`.
**Resolution:** The precondition is now a `failed` effect, or an `applied` effect whose binding row declares `repeat`. The carry criterion (accepted origins) is unchanged and still decided first.

### Conflict: the post-join adjudicator halts every act rebind of a resolved, unrefuted action case
**Stories involved:** Story 2 vs `build-review-rubrics-need-a-post-join-adjudicator-` Story 7, the regression criterion.
**Files:** `.docs/stories/build-review-halts-as-regression-when-a-repair-lef.md` vs `.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md`
**Type:** contradiction. **Severity:** blocking until resolved.
**Description:** #2033 said such a binding halts as a regression of the prior case "rather than resetting its history or consuming another kickback".
**Resolution:** The criterion now applies while the case's action effect is not `applied` or the row declares `repeat`. Its recovery text and the Done When ("Resolved-case regression halts with the original case id and both source traces") stay true for those halts. A residual rebind does not reset history either: the bound row stays byte-identical and the new case records it in `recurrenceOf`.

### Conflict: #1986 stops every bound re-raise of a regressed case without a fresh repair allowance
**Stories involved:** Story 2 vs `projects-cannot-add-portable-non-competing-build-r` Story 15, negative path 1.
**Files:** `.docs/stories/build-review-halts-as-regression-when-a-repair-lef.md` vs `.docs/stories/projects-cannot-add-portable-non-competing-build-r.md`
**Type:** oscillating, if left unresolved: satisfying this spec's Story 2 grants a new bounded repair to a bound re-raise of a regressed applied case, which breaks #1986's "rather than granting a fresh repair allowance"; restoring #1986's stop re-breaks Story 2. **Severity:** blocking until resolved.
**Resolution:** The criterion keeps the stop for an attempted open case, a regressed case whose effect is not `applied`, and a declared `repeat`. It states that a regressed applied case bound with `residual-gap` or no `reRaise` gets one new case that shares the lineage limit of three applied attempts. The cumulative cap criterion that follows is unchanged, so the feature's accumulated charges are still never reset.

## Pairs checked with no conflict
- `build-review-halts-needs-human-when-the-judge-reje` (#3461): its bindable set for a resolved `act` case with an applied action is `act`, `defer`, so a bound `act` row is admissible and reaches this spec's routing; its Story 3 keeps the open-case `semantic remediation case repeat` halt, which this spec's Story 3 negative path 2 also keeps. Both directions hold.
- `build-review-re-raises-already-decided-findings-ev` (#3294): provenance recurrence applies only to unbound rows with no exact-source owner; this spec's Story 3 negative path 3 keeps the unbound lane. Both directions hold.
- `refuted-build-review-finding-cycles-to-a-needs-hum` (#2409): refute bindings and the refutation-repeat halt are untouched, since `reRaise` counts only on `act` rows.
- `build-review-remediate-context-grows-with-the-whol` (#3291): the expansion round and context ceiling are untouched; `reRaise` is a judgement field, not a context field.
- This spec's own stories: Story 1's dropping rule and Story 3's unchanged halts are consistent with Story 2's routing in both directions.
