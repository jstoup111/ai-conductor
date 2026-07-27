# Architecture Review: daemon-mode DECIDE kickback guard (#551)

**Date:** 2026-07-27
**Verdict:** APPROVED (lightweight review — Tier M)
**ADR:** `adr-2026-07-27-daemon-decide-kickback-halt.md` (APPROVED)
**Reviewed against:** `.docs/architecture/2026-07-27-daemon-mode-kickbacks-route-human-judgment-gaps-in.md`

## What was reviewed

The proposal to extract a pure `decideKickbackDisposition` predicate and consult it from both
`planRemediation` and `scanKickbackVerdicts`, halting `needs-human` when a daemon-mode kickback
targets a DECIDE-phase step.

## Findings

### F1 — Scope of the issue is smaller than filed, and that must be stated (resolved)

The intake describes the DECIDE-rewind hole as open across remediation *and* verdict kickbacks.
Half of it is already closed: #644's guard at `conductor.ts:1722-1737` covers every
`planRemediation` route. Specifying the full hole would have produced a duplicate guard and a
misleading changelog entry. The plan and stories now scope the *new* behavior to
`scanKickbackVerdicts` and treat the `planRemediation` change as a **behavior-preserving
refactor**, with an explicit acceptance criterion that #644's existing coverage stays green
unmodified. Resolved.

### F2 — Halt classification is the load-bearing detail (resolved)

An `unclassified` HALT is mechanically re-kicked by `rekickSweep`; only `needs-human` is skipped
on every sweep (`daemon-rekick.ts:173-193`). A guard whose halt is auto-cleared is not a guard —
the daemon would clear it and walk straight back into the DECIDE dispatch. The ADR pins
`writeHaltMarker(..., 'needs-human')` and Story S5 pins it as a testable criterion (assert the
`HALT.class` sidecar content, not merely that `HALT` exists). Resolved.

### F3 — Ordering against the anti-ping-pong cap (resolved)

Placing the phase check before the cap check would change which reason a capped daemon run
reports and would risk masking the ping-pong signal. The ADR fixes the order: counter bump →
event emit → cap check → phase check → `navigateBack`. Story S4 asserts the cap behavior is
byte-identical. Resolved.

### F4 — Do not enforce in `navigateBack` (resolved)

`navigateBack` is shared with the rebase-invalidation re-open (`conductor.ts:4203-4238`) and the
deterministic BUILD kickbacks. Enforcement there would over-block or would need the same phase
test anyway. Enforcement stays at the two decision seams. Resolved.

### F5 — Derive phase from the `steps` table, never a name list (resolved)

`kickbackTarget` and `phase` are both configurable per step (`types/config.ts:146`,
`steps.ts:556-565`), so a hardcoded `['prd','architecture_review','stories','plan']` list would
silently miss a custom DECIDE step. The predicate takes `steps: StepDefinition[]` and resolves
phase from it. Resolved.

### F6 — Front-half call site inherits the guard (accepted, documented)

`conductor.ts:6420` calls the same scan with `navigate:false`. It will now also halt in daemon
mode. Reviewed and accepted as correct — in daemon mode the front half is preseeded done, so
reaching a front-half amendment kickback is itself anomalous and worth surfacing. Documented in
the ADR's Consequences rather than special-cased, because a `navigate`-conditional guard would
create a second, weaker rule.

### F7 — Interactive regression proof is by unmodified existing tests (accepted)

Outcome 3 ("interactive `/conduct` kickbacks unchanged") is proven by the continued, *unmodified*
passing of `test/integration/gate-loop.test.ts:224` and the front-half amendment suite at `:479`,
none of which set `daemon: true`. The plan must not touch those files; Story S3 states this
explicitly.

## Non-findings (checked, no action)

- No schema, config key, migration, or `settings.json` surface is touched → no migration block
  needed; a release waiver is not needed either, because no canonical breaking surface is in the
  diff.
- No new external call; the halt reuses `surfaceRemediationPr`, already daemon-gated.
- The predicate is pure and I/O-free, so it is unit-testable without a repo fixture.

## Out of scope (recorded, not blocking)

- `skills/remediate/SKILL.md` documents a halt category `unanswerable` that
  `readRemediationPlan` (`artifacts.ts:2888-2894`) silently drops — a real latent bug, separate
  issue.
- Four HALT sites bypass `writeHaltMarker` and emit no class sidecar
  (`conductor.ts:2472, 5440, 5601, 5694`) — separate cleanup.
- `selector.ts`'s dead `loopGatesOnly` flag — deliberately left unwired here; deleting it is a
  separate call.
- The forward-walk dispatch guard is #550.
- Per-`run()` in-memory kickback counters resetting across daemon dispatches is #989.

## Verdict

**APPROVED.** The seam is correct, minimal, and derived from data already in the step table; the
one genuinely dangerous detail (halt classification) is pinned by both the ADR and a story
criterion.
