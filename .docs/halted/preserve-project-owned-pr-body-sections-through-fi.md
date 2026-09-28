# Halt record

Status: halted
Slug: preserve-project-owned-pr-body-sections-through-fi
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-preserve-project-owned-pr-body-sections-through-fi
Head SHA: 047fecd5b48fd6605ec4035319f380a7df1697b5
Halted at: 2026-09-28T22:59:55.444Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — Blocking findings: AB-013 (DESIGN; adr-2026-09-24-project-owned-pr-body-regions decision 4): [verified, 99%] Config accepts any custom owner ordered before finish, including BUILD-phase owners (`config.ts:579-610`; `steps.ts:586-592`), but a draft is opened only at SHIP entry (`conductor.ts:7959-7983`). On a fresh run such an owner reaches region preparation before any PR exists and halts at `conductor.ts:3292`, contradicting D4 and the approved diagram's SHIP-draft-before-owner lifecycle. Resolving this requires choosing earlier publication or narrowing eligible owners.; AB-014 (REMEDIABLE; adr-2026-09-24-project-owned-pr-body-regions decision 2): [verified, 96%] D2 requires rejecting engine-owned markers or headings, but template validation reserves only the reduced-coverage heading and accepted-risk start marker (`pr-body-regions.ts:97-100`). It admits at least `<!-- build-review-accepted-risk:end -->` and `## Accepted build-review risk`, both defined as engine-owned accepted-risk identifiers at `build-review-accepted-risk.ts:7-10`.

Blocking findings:
AB-013 (DESIGN; adr-2026-09-24-project-owned-pr-body-regions decision 4): [verified, 99%] Config accepts any custom owner ordered before finish, including BUILD-phase owners (`config.ts:579-610`; `steps.ts:586-592`), but a draft is opened only at SHIP entry (`conductor.ts:7959-7983`). On a fresh run such an owner reaches region preparation before any PR exists and halts at `conductor.ts:3292`, contradicting D4 and the approved diagram's SHIP-draft-before-owner lifecycle. Resolving this requires choosing earlier publication or narrowing eligible owners.; AB-014 (REMEDIABLE; adr-2026-09-24-project-owned-pr-body-regions decision 2): [verified, 96%] D2 requires rejecting engine-owned markers or headings, but template validation reserves only the reduced-coverage heading and accepted-risk start marker (`pr-body-regions.ts:97-100`). It admits at least `<!-- build-review-accepted-risk:end -->` and `## Accepted build-review risk`, both defined as engine-owned accepted-risk identifiers at `build-review-accepted-risk.ts:7-10`.
```
