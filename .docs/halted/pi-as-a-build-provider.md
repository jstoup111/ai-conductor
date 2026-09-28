# Halt record

Status: halted
Slug: pi-as-a-build-provider
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-pi-as-a-build-provider
Head SHA: 85298106f5d035cdf900671a036f788c961a9e86
Halted at: 2026-09-28T12:09:36.327Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: post-dispatch verdict write handshake failed for architecture_review_as_built: .pipeline/architecture-review-as-built.md is stale (found mtime 2026-09-26T19:29:09.200Z); expected run id 89593a2c-35ff-4d33-abe4-fb01be93fdd6; found run id 89593a2c-35ff-4d33-abe4-fb01be93fdd6

Blocking findings:
AB-1 (REMEDIABLE; Task 17): Pi's abort handler has no production signal producer, so lifecycle cancellation cannot terminate a running Pi subprocess.
AB-2 (REMEDIABLE; Task 4): `REVIEW_PROVIDER_PREFIXES` is materially changed but remains test-only with no production consumer.
AB-3 (REMEDIABLE; Task 7): The descriptor-backed `defaultCiFixProbe` and its preflight have no production caller.
AB-4 (REMEDIABLE; Task 8): The structural guard excludes adapters and therefore cannot enforce the sealed catalog-owned display-name outcome.
AB-5 (DESIGN; adr-2026-08-12-per-provider-live-smoke-legs decision 1): Pi's standalone adapter smoke violates the approved shared full-daemon run-body architecture.
```
