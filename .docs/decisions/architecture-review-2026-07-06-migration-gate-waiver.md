# Architecture Review: TR-10 migration-gate waiver (fix #354)

**Date:** 2026-07-06
**Mode:** lightweight (tier M) — feasibility + alignment
**Track:** technical (no PRD; input = .docs/architecture/2026-07-06-migration-gate-waiver.md)
**Stories reviewed:** none yet — pre-stories review per adr-2026-06-29-architecture-before-stories
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TS inside the existing self-host module; no new deps. VERIFIED |
| Prerequisites | None — gate seams (`readText`, `changedFiles`) already injectable; `release-gate.test.ts` exists for hermetic coverage. VERIFIED |
| Integration surface | One module (`release-gate.ts`) + repo `CLAUDE.md` prose + HALT reason text. Composes ahead of the #282 remediate route (spec landed, not built). |
| Data implications | One new committed artifact path `.docs/release-waivers/<plan-stem>.md`; no schema/state changes. |
| Performance risk | None — one extra file read + set comparison at finish time. |
| Worktree isolation | Artifact is per-plan-stem inside the repo; no shared resources. |

## Alignment

- **adr-2026-06-30-halt-based-release-gates (APPROVED):** amended, not violated — the waiver
  adds a third *satisfying* condition to TR-10; fail-closed default, distinct HALT reasons,
  and uncertainty→HALT are all preserved (W4 keeps the null-diff case unwaivable).
- **adr-005-non-autonomy (APPROVED):** intact — the daemon still never merges; the waiver is
  operator-reviewed in the PR diff before merge.
- **#282 spec composition:** waiver validity is evaluated inside TR-10 before the
  missing/malformed disposition, so a waiver-satisfied build is `ok` to the remediate route,
  never a remediable defect.
- **Containment (operator constraint):** all logic behind `selfHost === true`; no consumer
  surface, no new harness-wide skill/step. Authoring guidance lives in the harness repo's own
  `CLAUDE.md`.
- **Pattern consistency:** mirrors `hasRunnableMigrationBlock` (regex-contract over committed
  text) and the existing gate-verdict shape (`GateVerdict`); no new pattern without the ADR.

## Domain Integrity (spot check, per lightweight mode)

- Waiver parsing follows **parse, don't validate**: parse once into a typed structure;
  canonical surface names exported as constants shared with the classifier (no string drift);
  unknown surface name = malformed (no catch-all).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Waiver rubber-stamping (waiver written where migration block was warranted) | Security/Process | Medium | High | W2 explicit rationale + exact surfaces; operator reviews waiver in PR (ADR-005 backstop); auditable per plan-stem |
| Canonical surface-name drift between classifier and parser | Technical | Low | Medium | Single exported constant set; parser rejects unknown names |
| Waiver leaks coverage across branches/slugs | Technical | Low | High | W1 freshness binding (must be in `base...HEAD`) + W3 superset rule |
| Build never learns waiver exists (keeps HALTing) | Process | Medium | Low | HALT reason names the waiver path; CLAUDE.md documents it |

## ADRs Created

- `adr-2026-07-06-migration-gate-waiver.md` — **DRAFT**, pending operator approval (hard
  gate before stories).

## Conditions

None. Verdict is APPROVED contingent only on the ADR reaching APPROVED status (lifecycle
gate, §7b), which is enforced before `/stories` runs.
