# Halt record

Status: halted
Slug: install-requires-a-manual-git-clone-no-curl-based-
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-install-requires-a-manual-git-clone-no-curl-based-
Head SHA: 3e4a495d4fbccdc641084d8545fea0af708a38fc
Halted at: 2026-09-22T22:23:08.331Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-1 (adr-2026-08-09-checkout-is-sole-version-identity-authority), AB-2 (adr-2026-08-09-checkout-is-sole-version-identity-authority)

Blocking findings:
AB-1 (DESIGN; adr-2026-08-09-checkout-is-sole-version-identity-authority): The stable updater lets persisted currentVersion decide the major-upgrade gate when local HEAD has no exact tag.
AB-2 (DESIGN; adr-2026-08-09-checkout-is-sole-version-identity-authority): The stable update check omits the identity/source line required on every invocation.
```
