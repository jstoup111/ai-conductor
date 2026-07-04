# Architecture Review: Operator Park (ai-conductor#236)

**Date:** 2026-07-04
**Mode:** Lightweight (tier M) — feasibility + alignment
**Inputs reviewed:** PRD `.docs/specs/2026-07-04-operator-park.md` (FR-1..FR-7), diagrams
`.docs/architecture/operator-park-a-human-placed-halt-must-survive-the.md`, explore decision
`.memory/decisions/operator-park-approach.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** pure Node fs + existing commander CLI wiring; no new packages, services, or infra.
- **Prerequisites:** none — `.daemon/` per-slug state pattern already exists
  (`warned/`, `processed/` in `engine/daemon-deps.ts`).
- **Integration surface:** four seams, all identified and bounded — `rekickSweep` deps
  (`engine/daemon-rekick.ts`), dispatch eligibility (`isHalted` call-site layer,
  `engine/daemon-deps.ts`), dashboard grouping (`engine/daemon-dashboard.ts`), CLI declaration +
  pre-boot dispatch (`src/cli.ts`, `src/index.ts`).
- **Data:** one new gitignored local directory `.daemon/parked/`; no schema, no migration.
- **Performance:** one `stat` per candidate slug per decision point; zero cost for repos with no
  parks. Meets the PRD's no-polling-load NFR.
- **Worktree isolation:** repo-root store is deliberately outside worktrees; parallel worktrees
  cannot conflict on it (single writer: the operator).

## Alignment

- **Marker single-source pattern:** follows `halt-marker.ts` (canonical constant + helpers, one
  module, all consumers import) — the pattern that module's header explicitly exists to enforce.
- **Sweep contract:** parked check slots into `rekickSweep`'s existing per-slug skip chain
  (before `isProcessed` and the FR-9 SHA guard); machine-halt behavior byte-for-byte unchanged
  (PRD FR-5). No change to the FR-9 guard's storage (explicitly deferred scope).
- **CLI dispatch:** matches the pre-boot detector pattern of observe/supervisor verbs; honors the
  #275 unknown-subcommand guard lineage.
- **Dashboard:** additive bucket at the head of the existing precedence chain; grouping logic
  already single-slug-single-bucket.
- **Deviation from explore, resolved here:** storage moved from worktree `.pipeline/PARKED` to
  repo-root `.daemon/parked/<slug>` — required by FR-1's no-worktree-yet case and
  worktree-teardown survival. Semantic decision (separate operator-owned state + verbs)
  unchanged. Captured in adr-2026-07-04-operator-park-marker.md.
- **EKS/remote posture:** park is per-checkout operator state, consistent with one-daemon-per-repo
  operations; multi-operator / origin-visible parks explicitly out of scope (noted for the #184
  lineage).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A future dispatch path forgets the parked check | Technical | Medium | High | Single canonical module + checks at the two chokepoints (sweep, eligibility) rather than scattered call-sites; stories assert every autonomous path |
| fs error on parked check misread as "not parked" → park violated | Data | Low | High | Fail-toward-parked on non-ENOENT errors (ADR decision 4) with logged anomaly |
| Slug-rename creates a stale park keyed to the old slug | Data | Low | Medium | Documented limitation, same class as existing slug-keyed ledger gap; unpark no-op is safe |
| Parked features rot silently (forgotten parks) | Knowledge | Medium | Low | FR-6 dashboard bucket keeps them visible on every status |

## ADRs Created

- `adr-2026-07-04-operator-park-marker.md` — APPROVED (operator, 2026-07-04)
- `adr-2026-07-04-park-unpark-cli-verbs.md` — APPROVED (operator, 2026-07-04)

## Conditions

1. Both ADRs must be operator-APPROVED before stories (hard gate — no DRAFT lands).
2. Stories must include negative-path scenarios for: sweep skip with HALT intact, restart
   persistence, unknown-slug park failure, idempotent re-park, unpark no-op, and the
   fail-toward-parked check-error path (per the negative-path spec rule: assert the contract at
   every call site with real adversarial inputs).
3. Docs + CHANGELOG in the same implementation PR (repo rule; restated in the verbs ADR).
