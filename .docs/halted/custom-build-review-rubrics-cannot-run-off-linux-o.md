# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-26T09:55:10.858Z
Slug: custom-build-review-rubrics-cannot-run-off-linux-o
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-custom-build-review-rubrics-cannot-run-off-linux-o
Head SHA: 084b0f7f1a25edab3b65c1de631242fdef621aaf
Halted at: 2026-09-26T09:48:04.347Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-1 (architectural-clarity: As-built AB-1 (99%, verified) is a conflict between approved constraints, not code drift: adr-2026-08-18 D3.2 says the lap publishes no aggregate, while D6 and story S6.6 require the reduced-coverage lever whose CLI reads the fault only from the aggregate (build-review-cli.ts:505-513), and active-plan task rem-as-built-rem-ab14-1 explicitly ordered the aggregate writes now at step-runners.ts:2840-2862 and :3504-3521; this same finding already exhausted the as-built lap cap (5/5) and the prior remediation halted it architectural-clarity, the operator re-kicked without amending the ADR or plan, and the as-built review states a human must choose between re-sourcing the lever's fault (e.g. from the build_review_rubric_infrastructure_failure spine event) without an aggregate or amending D3.2 (whose no-aggregate sentence sits in the review-input-mutated clause and may not govern read-only-review-unavailable) — either choice requires a sealed plan or ADR change, so a build task would cycle.)
```
