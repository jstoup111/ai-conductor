# Conflict Check: finish-record primitive (issue #281)

**Date:** 2026-07-07
**New stories:** .docs/stories/finish-step-fails-try-1-on-every-daemon-ship-skill.md
**Result:** CLEAN PASS — zero blocking, zero degrading conflicts.

## Pairs Examined (verified against story text, not assumed)

| Neighbor | Type checked | Finding |
|---|---|---|
| daemon-false-ship-guard.md | contradiction / overlap | Compatible: new stories mechanize the exact criteria the guard stories assert (success → `pr_url` then `pr`; STOP-gate failure → zero writes, lines 14/50/155-157 of the guard stories). Gate-side behavior untouched. `keep` fallback nuance preserved: gh unavailable up-front → skill chooses keep; gh error during pr verification → fail-closed refusal (guard's daemon gate rejects keep either way). |
| finish-force-with-lease-after-sanctioned-rebase.md | sequencing | Disjoint: push-direction gates run before the push; finish-record verifies evidence after it. No shared decision. |
| finish-should-rewrite-stale-needs-remediation-titl.md / halt-pr-presentation-reliability.md | state | Unchanged interaction: title rehabilitation remains the skill//pr's act and the completion gate still fails a stale title independently; finish-record does not (and must not) check titles. Identical to today's state machine. |
| content-aware-shipped-work-dedup-never-re-dispatch.md (shipped-record) | resource contention / posture | Different files, ordered invocations (shipped-record before final push; finish-record last). Opposite failure postures are deliberate and documented in adr-2026-07-07-finish-record-primitive (a wrong finish-choice is a false ship; a missing shipped-record only degrades dedup). |
| `.pipeline/finish-choice` writer set | resource contention | Single-writer preserved: the engine auto-mode prompt rewrite REPLACES the manual-write instruction with the command, so no path instructs two writers. |
| origin/spec/daemon-false-ships-finish-reports-done-with-prurl- (in-flight) | all | Branch adds no finish-seam stories beyond what main already carries. |

## Notes

No resolutions applied; no ADRs superseded. Proceed to /plan.
