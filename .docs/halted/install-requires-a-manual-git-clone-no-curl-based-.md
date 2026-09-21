# Halt record

Status: halted
Slug: install-requires-a-manual-git-clone-no-curl-based-
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-install-requires-a-manual-git-clone-no-curl-based-
Head SHA: 0f565842bc5d899551bf689c7ccb9b77c009bc4e
Halted at: 2026-09-21T18:17:56.901Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-1 (adr-2026-08-09-checkout-is-sole-version-identity-authority decision 1)

Blocking findings:
AB-1 (DESIGN; adr-2026-08-09-checkout-is-sole-version-identity-authority decision 1): The bootstrap introduces and defaults to a stable channel although the APPROVED decision limits channels to tagged and main.
```
