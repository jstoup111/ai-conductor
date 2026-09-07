# Halt record

Status: halted
Slug: page-background-intake-past-github-default-30-issu
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-page-background-intake-past-github-default-30-issu
Head SHA: 75a7be494047d027a637dc82559ba55c0ab15138
Halted at: 2026-09-07T23:26:22.936Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-2 (product-scope: The remedy is an entire APPROVED-but-never-implemented product seam that this feature's initial design never accounted for, so it needs a human DECIDE amendment rather than a remediation task. adr-2026-09-06-inbound-intake-trust-boundary (.docs/decisions/adr-2026-09-06-inbound-intake-trust-boundary.md:67-77) is not a one-call fix: its decision 1 choke point is inseparable from decisions 2-7 — the `[neutralized:<category>]` marker vocabulary and its closed category set, the code/quote segmentation exemption, the armor lines carrying `formatWorkRef` plus a sha256 digest inside `text`, a new additive `Envelope.inbound` field and `parseEnvelope` pass-through, `compose claim` and `persistClaimRecord` echoing it, and a new `intake_inbound_sanitized` ConductorEvent variant with an `EVENT_SINKS` declaration and a worktree-local `.pipeline/intake-events.jsonl` append in `engineer worktree --source-ref`. Shipping decision 1 alone would be non-conformant and would be re-raised by the next as-built gate. Neither `sanitizeInboundText` nor `intake/sanitize-inbound.ts` exists anywhere under src/conductor/src; src/conductor/src/engine/engineer/intake/github-issues.ts:80-90 still joins raw title and body and :247-264 passes it into the envelope, and the review confirms both conditions predate this branch at merge base 847265f69. Nothing in .docs/stories/page-background-intake-past-github-default-30-issu.md or the Small-tier plan (Tasks 1-3: an argv `--limit` element, a 45-issue acceptance proof, and one saturation warning) admits an envelope-schema change, a new event variant, or a claim-surface change, so no `build`, `existing-task`, or in-scope `plan` route exists. The human decision is scoping, not clarity — whether adr-2026-09-06 ships as its own feature (recommended) or this feature's scope is amended to carry it — which is why this is product-scope and not architectural-clarity: the architecture itself is unambiguous and no superseding ADR is being proposed. Confidence 95%, verified by reading the full ADR decision list, the adapter source at both cited ranges, the sealed stories and plan, and a source-tree search confirming the module's absence.)
```
