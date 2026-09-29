# Halt record

Status: halted
Slug: pi-as-a-build-provider
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-pi-as-a-build-provider
Head SHA: a0bd6af50f6bebaec3b6a70c67c88cc856d28eeb
Halted at: 2026-09-29T02:55:05.596Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-14 (architectural-clarity: Two authoritative sources contradict (verified, 90%): approved adr-2026-09-10-portable-build-review-policy D5.5 requires an unavailable custom-policy candidate to be skipped via provider_attempt invoked:false / skipReason setup-unavailable and the next candidate tried, but step-runners.ts:850-858 casts a registered external plugin key to BuiltInProviderId, provider-catalog.ts:228-232 throws 'Unknown built-in provider', and step-runners.ts:857-858 plus provider-execution.ts:1050-1051 rethrow it; the operator explicitly accepted exactly this throw on 2026-09-28 (.pipeline/accepted-widenings.json decision f1b39a80, criterion NC.2: 'a non-catalog build_review candidate failing with Unknown built-in provider is the intended behavior under the provider catalog'). Implementing the as-built remedy reverses an operator decision; leaving the code violates an APPROVED ADR. A human must choose: (a) rescind the NC.2 acceptance and task step-runners.ts unavailableReviewCapabilityResult to return the setup-unavailable skip result for non-catalog keys (Task 5 admits it: custom-policy read-only admission 'refuses a candidate ... without invoking it'), or (b) amend ADR D5.5 to exclude non-catalog plugin candidates and record the as-built waiver.); NC.1 (architectural-clarity: Same defect as AB-14 (step-runners.ts:850-858 rethrowing provider-catalog.ts:229-232 'Unknown built-in provider' for an external llm_provider plugin candidate); the audit itself notes the operator accepted this behavior as intended on 2026-09-28 (accepted-widenings.json NC.2), while approved ADR D5.5 requires skip-and-advance, so it shares AB-14's human decision and must not be re-tasked autonomously.)
```
