# Architecture Review: SHIP-tail verdict run-identity contract (#1838)
**Date:** 2026-08-25
**Stories reviewed:** none yet (pre-stories DECIDE review, technical track)
**Verdict:** APPROVED WITH CONDITIONS

Lightweight mode (Medium tier): feasibility + alignment only.

## Feasibility

- **Identity source exists:** the engine already mints a unique per-dispatch
  `attempt.id` (`provider-lifecycle.ts:388`) — no new scheme, no new state. Verified, 90%.
- **Stamp seam exists:** #817's gate-code-validity sidecars (`PRD_AUDIT_CODE_STAMP` etc.)
  already write engine-authored identity beside these artifacts on the settle path; run
  identity is a second field on the same contract. Verified.
- **Reader seam exists:** completion predicates already consult `verdictFreshnessComparand`;
  `classifyPrdAuditGaps` takes only `sessionStartedAt` today and must gain the shared
  identity helper — the one genuinely new reader change. Verified (`artifacts.ts:4203`).
- **No new integrations, schema, or infra.** Worktree-safe: all state is per-worktree
  `.pipeline/`.

## Alignment

Full repo-wide ADR sweep performed (291 ADRs). Governing set and dispositions are recorded
in adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity ("Supersessions and
amendments", "Options considered"). Key alignment facts:

- Engine-stamped identity conforms to adr-2026-08-19-engine-stamped-rubric-judged-result-
  envelope (no provider echo) and mirrors build_review's lapId.
- Identity mismatch ⇒ `routeClass: 'absent'` ⇒ rerun preserves the retry-classify
  interlock (adr-2026-07-13-retry-classify-rerun-vs-route D1).
- Mtime fallback for unstamped artifacts and the existing kill-switch are inherited from
  #817 D3/D6 — no new config key (adr-2026-08-19-unretryable… D4).
- manual_test composes with its attempt-section + HEAD whitewash machinery (#367).
- Telemetry extends `verdict_freshness`/`retry_decision` — event-spine principle honored,
  no parallel channel.
- Halts go through `writeHaltMarker` with class `needs-human` and inherit the committed
  halt record (adr-2026-08-23).

## Wiring Surface

| New/changed surface | Called from (design-time commitment) |
|---|---|
| Run-identity stamp write (second field on gate-code-validity sidecar) | Conductor's verdict-dispatch settle boundary in `src/conductor/src/engine/conductor.ts` (same seam that writes `codeStamp` today) |
| Post-dispatch write handshake | Conductor step loop, immediately after provider settle and before `checkStepCompletion`, for the three verdict steps (serial and validation-group branches) |
| Shared identity helper (extends gate-code-validity helper) | `prd_audit`/`architecture_review_as_built`/`manual_test` completion predicates and `classifyPrdAuditGaps` in `src/conductor/src/engine/artifacts.ts`; the stale-artifact sweep (#817 D4) |
| `verdict_freshness` `floorSource: 'run-identity'` + `retry_decision` signal extension | Existing emitters in `artifacts.ts`/`conductor.ts`; consumed by `EventPersister` → `.pipeline/events.jsonl` (existing spine) |
| Staleness/halt reason text naming artifact + both identities | Existing retry-exhaustion and prd_audit halt writers in `conductor.ts` via `writeHaltMarker` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Validation-group branch settles race the stamp write, scoring a genuine fresh verdict stale | Technical | Medium | High | Stamp on the per-branch settle path before join reads (adr-2026-07-10-validation-group-join: branches own their `.pipeline/` artifacts); handshake compares observed write, stamp binds durably |
| Legacy/unstamped artifacts (mid-upgrade worktrees) mis-scored | Data | Medium | Medium | D7 mtime fallback — unstamped never more trusted than today, never less |
| Retry-classify `inputsUnchanged` semantics drift when re-keyed to identity | Technical | Low | Medium | Amendment scoped to D2 only; `absent`⇒rerun mapping covered by tests |
| Handshake false-negative (audit wrote via unexpected path) | Technical | Low | Medium | Handshake reason names artifact + both identities; bounded retry absorbs one-offs |

## ADRs Created

- adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity (pending operator approval)

Amendment notes to be added beside the amended assertions in
adr-2026-07-13-session-fresh-verdict-artifacts, adr-2026-07-22-gate-evidence-code-validity-
on-redispatch, and adr-2026-07-13-retry-classify-rerun-vs-route upon ADR approval.

## Conditions

1. The new ADR must be operator-APPROVED before stories.
2. Amendment notes (additive, per accepted-artifact amendment rule) land in the three
   amended ADRs in this same DECIDE pass.
3. Stories must cover the validation-group race explicitly (stamp-before-join).
4. Root-causing the original non-write (attempt 14) stays best-effort in BUILD; it must not
   grow the scope beyond the track marker's boundary.
