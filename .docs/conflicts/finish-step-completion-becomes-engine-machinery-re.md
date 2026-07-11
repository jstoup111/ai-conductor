# Conflict Check: Finish-step completion becomes engine machinery

**Date:** 2026-07-11 · Tier M · intake jstoup111/ai-conductor#499
**New stories:** `.docs/stories/finish-step-completion-becomes-engine-machinery-re.md`
**Result:** PASSED — 3 findings, all resolved (operator-approved); zero blocking conflicts remain.

## Finding 1 — RESOLVED: repair cleared halt signals before the gate verdict

**Stories involved:** new Story 1 (in-step repair, ADR D1) vs
`adr-2026-07-05-needs-remediation-redispatch` (label-armed redispatch) and
`halt-pr-presentation-reliability.md` D4 (body-marker-driven reconciliation sweep).
**Type:** state conflict / sequencing · **Severity:** degrading (potentially blocking) ·
**Confidence:** 60% as-found.

As originally specced, the repair ran pre-dispatch + pre-gate on every finish attempt —
including attempts that then failed the gate and terminally halted — clearing the
`needs-remediation` label, body marker, and draft state on a PR that did not ship. That
strands the PR outside both recovery routes (redispatch requires the label; the sweep
enumerates by body marker), re-opening the #268/#269 mergeable-exposure window. The
re-escalation re-mark was plausible but never established as a guarantee in the spec.

**Resolution (operator-approved): order-gate the repair.** Single invocation inside the
completion evaluation, run only after the non-presentation conditions (finish-choice,
pr_url, push evidence) all pass, strictly before the presentation checks; the
pre-dispatch invocation was dropped. A refusing/failing attempt never clears halt
signals. Applied to: ADR D1 (revised in-place, pre-land, operator-approved), new
Stories 1–2, both architecture diagrams.

## Finding 2 — RESOLVED: isDraft gate vs pr_timing TS-5 draft-left end-state

**Stories involved:** new Story 3 (D3 isDraft check) vs
`make-daemon-build-push-pr-timing-a-configurable-st.md` TS-5 (unshipped #199).
**Type:** contradiction / behavioral overlap · **Severity:** degrading · **Confidence:** 70%.

TS-5's negative path declared "flip fails → PR left draft, build still completes"; the
new gate fails exactly that end-state. Broad gh outage was already reconciled (gate is
fail-open when reads fail); the divergence was the flip-fails-while-reads-work case.

**Resolution (operator-approved): supersede TS-5's end-state** — deliberate #439
closure: when reads work, a persistently-draft PR fails the gate; bounded retries drive
the order-gated repair, and exhaustion halts. Supersession note added to the pr_timing
story.

## Finding 3 — RESOLVED: stale daemon-tail wiring assertion in #271 stories

**Stories involved:** new Story 1 vs `finish-should-rewrite-stale-needs-remediation-titl.md`
Story 3 Done-When ("`daemon-cli.ts` post-run tail invokes it…").
**Type:** contradiction (intended supersession) · **Severity:** degrading · **Confidence:** 95%.

**Resolution (operator-approved):** supersession note added to the #271 story pointing
at `adr-2026-07-11-finish-step-engine-completion-machinery.md` (which declares
`amends: adr-2026-07-03 Decisions 1 and 2`).

## Pairs examined and judged clean

- New D4 surgical retry vs finish-record primitive stories / adr-2026-07-07 — same
  fail-closed CLI ends the surgical prompt; refusal semantics intact.
- New D3 seam vs `daemon-false-ship-guard.md` (CompletionContext injectables) —
  convergent extension of the same seam, not contention.
- New feature vs adr-2026-07-05 D5 (body-marker strip at finish) — the relocated call is
  the same `rehabilitateHaltPr` → `cleanupHaltPresentation`; the sweep loop still closes,
  now only on shipping attempts (Finding 1 resolution strengthens this).
- New D2 retitle-floor vs #271 Story 1 (skill prose rewrite) — prefix-gated backstop;
  prose wins whenever written.
- New D3 isDraft vs adr-2026-07-05 draft-alone rule / #199 early-draft — ship-readiness
  framing, no halt re-classification.
- New D5 vs finish/pr SKILL contradiction — this feature IS the resolution;
  finish-record exit contract stays an agent instruction.
- New feature vs `content-aware-shipped-work-dedup-never-re-dispatch.md` — disjoint
  state surfaces.
- Unmerged/pending spec branches: #500 (parallel validation) touches `artifacts.ts` only
  for stale-sweep machinery — file proximity, no behavioral overlap with the finish
  predicate; #522/#520 (evidence gate) and #507/#505 (attribution) touch different
  functions — git-merge proximity only, handled by the sanctioned rebase machinery.

## Re-check

After applying all three resolutions, the pairwise interactions were re-examined:
Finding 1's resolution removes the signal-clearing window (repair cannot precede a
failing verdict); Finding 2's supersession is recorded at the superseded story; Finding
3 is documentation-only. Zero blocking conflicts remain; no degrading compromise is left
unaccepted.
