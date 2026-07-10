# Conflict Check: Daemon merged-PR guard on step retry (#358)
**Date:** 2026-07-09
**New stories:** `.docs/stories/2026-07-09-daemon-merged-pr-guard-on-retry.md` (TS-1…TS-5)
**Result:** PASSED after 2 guided resolutions — zero blocking conflicts remain.

## Scope of the scan

All 91 story files scanned by touchpoint (ship markers `finish-choice`/`DONE`,
`markProcessed`/`isVerifiedShip`, `performRebase`/`runRebaseStep`, kickback/`navigateBack`,
dedup/re-dispatch). Pairs actually reasoned through (not just keyword-matched):
`daemon-false-ship-guard`, `2026-07-05-rekick-gated-rebase-resolution`,
`daemon-auto-resolve-gitignored-rebase-conflicts`, `content-aware-shipped-work-dedup`,
`finish-step-fails-try-1-on-every-daemon-ship-skill`,
`finish-should-rewrite-stale-needs-remediation-titl`,
`post-rebase-build-invalidation-dispatches-a-full-b`, `daemon-logs-surface-kickback-steps-visibly`.

## Conflict 1: finish-choice=pr writer set widens (resolved)

**Stories involved:** TS-3 (synthetic verified-ship) vs `daemon-false-ship-guard` Story 6
**Type:** behavioral overlap  **Severity:** degrading  **Confidence:** high (verified against
Story 5/6 text)

Story 6's invariant: `finish-choice=pr` is written only with proven ship evidence (finish skill
proves via `gh pr view` + push-ancestry). The guard writes the same marker on a live `MERGED`
verdict where push-ancestry may not hold.

**Resolution (applied):** documented exemption added to TS-3, mirroring Story 5's existing
repair-path exemption — the merge itself is the proof. Invariant preserved as
"marker ⇒ proven ship (finish proof OR live-MERGED proof)". No text change needed in
`daemon-false-ship-guard` (its Story 5 already establishes the exemption pattern).

## Conflict 2: rekick play-forward blind spot (resolved — scope extension)

**Stories involved:** TS-2 (rebase backstop) vs `2026-07-05-rekick-gated-rebase-resolution`
**Type:** sequencing / coverage gap  **Severity:** degrading  **Confidence:** high (verified:
`resumeRebaseFirst` calls `performRebase` directly, outside `runRebaseStep`)

A feature merged by hand while parked would re-halt on the same duplicate-branch conflict via
the rekick path, which the two original guard sites never see; rekick-time `isProcessed` dedup
is ledger-based and equally blind.

**Resolution (applied, operator-approved):** third guard call site added — new story TS-5;
ADR `adr-2026-07-09-mid-run-merged-pr-guard` amended in place (pre-land, same review cycle) to
three insertion points; components diagram updated. The rekick gated-resolution stories'
non-MERGED behavior is byte-identical (TS-5 negative paths pin this).

## Examined-clean pairs

- `daemon-auto-resolve-gitignored-rebase-conflicts` — guard exits before `performRebase`; all
  `RebaseOutcome` variants (incl. `artifact_resolved`) untouched on non-MERGED.
- `content-aware-shipped-work-dedup` — complementary: guard feeds the same ledger marker the
  dedup consumes; no second dedup mechanism introduced.
- `finish-should-rewrite-stale-needs-remediation-titl` — fixes the #358 *trigger* (stale title);
  the guard fixes the *race*; disjoint behaviors, both can hold.
- `post-rebase-build-invalidation` — applies only when a rebase ran; guard-stopped runs never
  reach it.
- `finish-step-fails-try-1` — finish-record CLI argv semantics; orthogonal to guard timing.
- `daemon-logs-surface-kickback-steps-visibly` — kickback logging unchanged on non-MERGED; the
  guard adds one log line of its own on MERGED.

## Re-check

After both resolutions: TS-1…TS-5 re-scanned against the pairs above — no new interactions
introduced by the TS-5 addition (its negative paths defer to the existing rekick stories).
Zero blocking, zero unaccepted degrading conflicts.
