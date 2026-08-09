# Architecture Review: ADR approval enforced before build

**Date:** 2026-08-08
**Mode:** Full pass (pre-stories), Tier M — lightweight (Feasibility + Alignment + Wiring Surface)
**Feature:** adr-approval-gate-before-build
**Issue:** jstoup111/ai-conductor#662
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependencies. Pure TypeScript in the existing engine, plus one `git ls-tree` invocation matching the existing `listShippedFiles` pattern. |
| Prerequisites | **One hard prerequisite:** the three 2026-07-13 `Proposed` ADRs must be stamped before the gate is live, or every land and every dispatch blocks immediately. Landed in this same spec change. |
| Integration surface | Three files change behavior (`artifacts.ts`, `land-spec.ts`, `daemon-backlog.ts`), one migrates (`authoring.ts`), one interface extends (`backlog-tree-source.ts`). No module boundary is crossed that isn't already crossed. |
| Data implications | None. No schema, no migration, no persisted format change except one added value in the `BlockedSpecItem.reason` union written to `.daemon/blocked.json`. |
| Performance risk | **Real and addressed.** `readFile` is one `git show` subprocess per file; 238 files measured at **0.90s**. Placing the scan inside the per-candidate loop makes discovery quadratic in backlog size. The companion ADR requires the scan be hoisted to once per pass. |
| Worktree isolation | Unaffected. The check is read-only against the base-branch tree; no ports, services, or shared mutable state. |

**Blocking feasibility issue found and resolved during review:** rung 2 as originally scoped was
**not buildable**. `BacklogTreeSource` exposes only `listPlanFiles`, `listShippedFiles`, and
`readFile` — no way to enumerate `.docs/decisions/`. Resolved by extending the interface
(`adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition`). Had this not surfaced at
DECIDE, it would have surfaced mid-BUILD as an unimplementable task.

## Alignment

- **Design Principle (deterministic over prompt discipline):** strongly aligned. This is the
  canonical case the principle describes — a rule that lived only in prose (`SKILL.md` §7b and the
  as-built reviewer's prompt) becomes machinery that rejects at the moment of the mistake.
- **Fail-closed convention:** aligned with the release gate's treatment of an unrecognized surface
  name as malformed rather than silently accepted.
- **Operator-lever precedent** (`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`):
  honored — every blocked spec gets a `blocked.json` row naming the offending ADR and a remedy.
- **Existing pattern reuse:** the rung-2 block mirrors the adjacent `stories-not-approved` check
  (same `blockedItems` shape, same `warnOnce` discipline), so it introduces no new pattern and
  needs no departure justification.
- **Append-only ADR convention:** honored. The three legacy ADRs are stamped, not rewritten or
  deleted; their content is untouched.
- **Documentation upkeep:** `docs/explanation/gates.md` (new gate) and the stalled-or-stuck runbook
  are in scope for the same PR.

**Alignment defect found in the authoring surface.** `templates/adr.md.template` instructs authors
to write `Proposed | Accepted | Superseded by …`, and `skills/architecture-review/SKILL.md` §7b is
written in a third vocabulary. Neither `Proposed` nor `Accepted` is in the gate's allowlist. Left
unchanged, every newly-authored ADR would fail the new gate on day one — converting a latent defect
into an immediate outage. Both must be corrected in the same change. This is a **condition**, not a
suggestion.

## Wiring Surface

| New/changed production surface | Where it is called from in production |
|---|---|
| `adrApprovalStatus(content)` — new export in `artifacts.ts` | Called by `landSpec()` in `land-spec.ts` (engineer `land` CLI path) and by the eligibility block in `discoverBacklog()` in `daemon-backlog.ts` (daemon poll loop). Both are existing, wired entry points. |
| `BacklogTreeSource.listAdrFiles()` — new interface method | Called by `discoverBacklog()` once per pass; implemented by the git-backed tree source constructed in `daemon-backlog.ts` and honored by the `shipped-record.ts` implementer. |
| `'adr-not-approved'` — new `BlockedSpecItem.reason` value | Produced in `discoverBacklog()`'s eligibility block, persisted via the existing `persistBlockedSnapshot` → `.daemon/blocked.json`, consumed by the existing dashboard renderer. |
| Removal of `hasDraftAdr` | Both current callers (`land-spec.ts:316`, `authoring.ts:472`) migrate to `adrApprovalStatus`; no caller is left behind. |

No surface here is new-and-unreachable: every one lands on an already-wired call path.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| One non-conforming ADR stalls the entire backlog (repo-wide scope) | Technical | Medium | **High** | Deliberate operator choice. Offending file + actual status named in the log line and in every blocked row's remedy; recovery is a one-line edit, no restart needed. |
| Legacy `Proposed` trio not stamped before the gate goes live | Data | Low | **High** | Stamped in this same spec change; the review's Conditions make it blocking. |
| Corpus scan left inside the per-candidate loop | Performance | Medium | Medium | Companion ADR mandates hoisting; measured 0.90s baseline documented so a regression is recognizable. |
| Parser rejects a legitimate ADR written in an unanticipated format | Technical | Low | Medium | Grammar tolerance verified against all 239 ADRs (236/3/0); error message prints the file and the status text actually found. |
| Author guidance left contradicting the gate | Knowledge | **High** if unaddressed | High | Template + SKILL.md §7b corrections are a blocking condition. |

## ADRs Created

- `adr-2026-08-08-single-adr-approval-parser-three-rungs.md` — the parser contract and the three
  enforcement rungs.
- `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md` — rung-2 mechanics:
  interface extension, once-per-pass evaluation, per-slug reporting, poison-pill acceptance.

Both are pending operator approval and must reach an approved state before `/stories`.

## Conditions

1. **Stamp the three 2026-07-13 ADRs in the same change.** Without it the gate blocks all work on
   day one. (Verified unsuperseded; issues #647/#649/#651 all CLOSED.)
2. **Correct `templates/adr.md.template` and `skills/architecture-review/SKILL.md` §7b** to the
   allowlist vocabulary. Without it every newly-authored ADR fails the gate.
3. **The corpus scan must be hoisted out of the per-candidate loop** in `discoverBacklog`.
4. **The parser must exclude fenced code blocks and match line-anchored declarations only.** An ADR
   documenting this feature necessarily contains examples of rejected statuses; a whole-file scan
   would make the feature unable to describe itself.
5. **An empty ADR set must pass.** Fail-closed applies to an unparseable ADR, never to a repo that
   has authored none — consumer projects must stay buildable.

## Blocking Issues

None outstanding. The one blocking feasibility defect (no directory listing on `BacklogTreeSource`)
was resolved during this review via the companion ADR.
