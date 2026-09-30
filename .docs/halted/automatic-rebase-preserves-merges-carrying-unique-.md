# Halt record

Status: halted
Slug: automatic-rebase-preserves-merges-carrying-unique-
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-automatic-rebase-preserves-merges-carrying-unique-
Head SHA: 014f41082a76c1d3afa334979baf3c59129609da
Halted at: 2026-09-30T13:01:58.963Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-6 (architectural-clarity: ADR adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D5 requires flatten_refused to carry merge sha, both parents and the flattened sha, but some merge-bearing refusals occur before those exist (rev-list --merges failure/malformed output, planning failure, tree mismatch on an all-ancestry-only list: rebase.ts:1005-1044); an earlier lap flagged the placeholder-sha flatten_refused (then D8) and this lap flags the flattened:false downgrade to conflict_halt/rebase-error (rebase.ts:1414-1424, autoresolve.ts:1143-1150), so no code change satisfies both readings — the as-built resolution itself names the human-approved ADR amendment (a distinct generic pre-mutation refusal, or D5 fields made optional) as the only other exit; prd-audit NC.1 graded the current downgrade within intent. 90% confidence (verified against the refusal builder and both lap findings).)
```
