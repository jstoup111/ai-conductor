# Conflict Check: SHIP-tail verdict run-identity contract (#1838)

**Date:** 2026-08-25
**New stories:** .docs/stories/prd-audit-halts-on-a-stale-report-when-the-audit-d.md (Stories 1–7)
**ADR corpus:** change_set (`conflict_check.adr_corpus` unset) — the new ADR
adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity plus the three ADRs it amends
(session-fresh-verdict-artifacts, gate-evidence-code-validity-on-redispatch,
retry-classify-rerun-vs-route) and the composed ADRs it cites (manual-test-fail-routing,
validation-group-join, engine-stamped-rubric-judged-result-envelope). A repo-wide ADR sweep
(291 ADRs) ran during architecture-review; its dispositions are folded into the ADR itself.

**Result: PASSED — zero blocking, zero degrading conflicts.**

## Examined pairs (both directions)

- **Story 3 vs adr-2026-07-22 (#817) preserve path** — preserve holds only for a
  matching-identity stamp (amended D5); Story 3's negative path pins the stale-report
  re-read. Satisfying either leaves the other intact. Clean.
- **Story 4 vs adr-2026-07-13-retry-classify D1/D2** — mismatch⇒`absent`⇒rerun preserves
  the ADR's mapping verbatim; matching-adverse⇒`named-route` preserved by Story 4's third
  negative path (no oscillation: fresh-adverse routes, stale reruns — disjoint conditions).
  Clean per the amended D2.
- **Story 5 vs adr-2026-07-13-session-fresh "no verdict-artifact sweep"** — Story 5 sweeps
  nothing; readers treat prior-identity artifacts as absent input. Clean.
- **Story 6 vs adr-2026-07-13-session-fresh mtime floor** — the floor survives verbatim as
  the unstamped fallback; the historical stories file
  `.docs/stories/session-fresh-verdict-artifacts.md` describes shipped behavior that
  remains true for unstamped artifacts (superseded-in-part provenance lives in the amended
  ADR, per the accepted-artifact amendment rule). Clean.
- **Story 7 vs adr-2026-07-06-manual-test-fail-routing (#367)** — whitewash guard wins even
  with a matching stamp (Story 7 negative path); attempt-section evaluation unchanged. Clean.
- **Story 1 vs adr-2026-07-10-validation-group-join** — the identity sidecar is a
  branch-owned `.pipeline/` artifact written on the branch settle path; state/gate verdict
  writes stay join-owned. Clean.
- **Story 1/2 vs adr-2026-08-19-engine-stamped-rubric-judged-result-envelope** — stamps are
  engine-authored, provider values ignored-never-validated (Story 1 negative path). Clean.
- **Story 2 vs adr-2026-07-11-pipeline-state-durability** — handshake fail-closed for the
  verdict, never throwing out of the loop (Story 2 negative path). Clean.
- **Story 3 vs adr-2026-08-22-prd-audit-stories-authority** — identity check sits before
  grade classification; grading semantics untouched. Clean.
- **Historical story file `gate-step-completion-validates-against-code-state-.md` (#817)** —
  its scenarios remain true; run identity is additive beside `codeStamp` with the same
  fallback/kill-switch scenarios. Clean.

No contradiction, overlap, state, resource-contention, sequencing, or oscillating conflicts
found. No resolutions applied; no superseding ADR created; no review marker written.
