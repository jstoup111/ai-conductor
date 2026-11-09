# Conflict Check: Decision-corpus query and known record shapes (#1480)

**Date:** 2026-11-07
**Stories checked:** `.docs/stories/adr-001-still-decides-no-custom-runtime-against-a-.md` (Stories
1–4) against every story in `.docs/stories/`. Pairs were narrowed to stories that touch the decision
corpus, land's ADR gates, `adrApprovalStatus`, the artifact manifest, docs pruning or the amendment
convention.
**Result:** Passed. 0 blocking; 1 degrading overlap, resolved by amending Story 4.

## ADR corpus

**Examined:**
- `adr-2026-11-07-decision-corpus-query-and-known-record-shapes`, the governing ADR
- `adr-2026-10-24-per-feature-artifact-manifest`, decisions 2 and 5: ADRs stay in the shared folder,
  and repository-scoped corpora stay on legacy resolution
- `adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest`
- `adr-2026-09-28-skills-may-bundle-executable-helpers`, which receives an additive amendment note
  from this spec
- `adr-2026-08-09-operator-only-scoped-artifact-reseal`, for the protected-artifact seal over
  `.docs/decisions`
- `adr-2026-07-06-migration-gate-waiver`, for the additive CLI surface

**Narrowed out:** all remaining APPROVED ADRs. Their subjects do not overlap these stories. A search
of the `adr-*` corpus for an append-only or no-deletion rule on decision records found none; the
convention lives only in the architecture-review skill's prose. The governing ADR's D1 records the
operator-authorized exception to it. No ADR was excluded as superseded.

## Conflict: Shape-rule ordering versus the no-masking rule for land gates

**Stories involved:** Story 4 (Land refuses newly added off-shape corpus files) vs Story 2 (Leave
decision records that predate the spec exactly as they are)
**Files:** `.docs/stories/adr-001-still-decides-no-custom-runtime-against-a-.md` vs
`.docs/stories/reject-non-date-named-adrs-at-spec-land.md`
**Type:** overlap
**Severity:** degrading

**Description:** The earlier story requires that a new land rung never mask an existing gate: "the
existing approval refusal is what land reports". Story 4 did not say where the shape rule sits.
When a change set adds an unapproved ADR and an off-shape file together, the two stories could
expect different refusals.

**Resolution Options:**
1. Run the shape rule after the existing ADR gates, and add a Story 4 negative path saying so.
2. Collect every gate failure into one refusal. That changes how the existing gates report.

**Recommendation:** Option 1, because it matches the precedent and leaves the existing gates alone.

**Resolution (operator, 2026-11-07):** Option 1. Story 4 gained the negative path and a Done When
check asserting the `adr-not-approved` refusal.

## Pairs checked clean

- **Story 4 vs `reject-non-date-named-adrs-at-spec-land` Story 1.** A sequential-number
  `adr-0001-x.md` matches the `adr-` shape, so the shape rule passes it and the canonical-name rung
  still refuses it. Each story holds when the other is fully satisfied, in both directions.
- **Stories 2–3 vs `adr-approval-gate-before-build`.** Disposition reuses `adrApprovalStatus`
  unchanged, and the approval gate reads only `adr-*`. Deleting the non-`adr-` record 001 does not
  affect it.
- **Story 3 vs `decide-artifacts-are-too-repetitive-for-people-to-`.** Manifest `decision` entries
  must sit under `.docs/decisions/`. The query reads the same directory through
  `MANIFEST_KIND_LOCATIONS`. Note that the manifest parser also hard-codes `.docs/decisions/`
  (`feature-manifest.ts`), so a future relocation must update both. That is out of scope here and is
  carried in the follow-up comment on #3419 and #782.
- **All stories vs `shipped-features-decide-artifacts-accumulate-in-do`.** Docs-prune keeps the
  `.docs/decisions` family, so it never removes a record the query lists.
- **The spec's amendment notes vs `stories-represent-current-behavior-without-amendme` Story 2.** The
  four notes on records that cite 001 use the required dated additive form and keep the original
  text.

No oscillating, state, resource-contention or sequencing conflicts were found.
