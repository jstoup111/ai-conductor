# Halt record

Status: halted
Slug: install-requires-a-manual-git-clone-no-curl-based-
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-install-requires-a-manual-git-clone-no-curl-based-
Head SHA: 5e17b551e369ad7339ddd417360d3cb023f76cac
Halted at: 2026-09-22T13:16:03.994Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-1 (adr-2026-08-09-checkout-is-sole-version-identity-authority)

Blocking findings:
AB-1 (DESIGN; adr-2026-08-09-checkout-is-sole-version-identity-authority): The stable updater lets persisted currentVersion decide the major-upgrade gate when the checkout has no exact tag.
```
