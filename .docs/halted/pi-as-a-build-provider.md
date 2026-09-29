# Halt record

Status: halted
Slug: pi-as-a-build-provider
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-pi-as-a-build-provider
Head SHA: 616a6123265b96381c55a06c1b1e2d19a005ebb8
Halted at: 2026-09-29T04:03:40.660Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — Blocking findings: AB-17 (REMEDIABLE; plan task rem-as-built-rem-pg1-1): Verified 100% from current source: BuiltInProviderDescriptor.adapterModule is populated in production at provider-catalog.ts:46,89,120,152 but has no production reader; repository-wide references outside its declaration are confined to provider-id-literals.test.ts. Move adapter ownership metadata to the structural-test surface or give it a genuine production consumer.; AB-18 (REMEDIABLE; plan task rem-as-built-rem-ab8-1): Verified 100% from current source: bootComposeEngineerLaunch is reached, but command, registry, config, and rendererOpts are unread; production supplies a no-op launch callback whose result is ignored, while the real spawn occurs later through launchClaudeEngineer. Collapse this to an honest validation-only helper or wire its declared boot-and-launch contract through production.; PG-3 (DESIGN; plan task rem-as-built-rem-pg1-1): Verified 99% against sealed Story 1 and current source: the remediation task requires an adapter's own displayName to remain exempt, and provider-id-literals.test.ts:82-85,178-186 enforces that exemption. This contradicts the sealed criterion requiring every user-facing provider display string to originate from the catalog; an exact literal such as 'Codex' inside the Codex adapter passes undetected.

Blocking findings:
AB-17 (REMEDIABLE; plan task rem-as-built-rem-pg1-1): Verified 100% from current source: BuiltInProviderDescriptor.adapterModule is populated in production at provider-catalog.ts:46,89,120,152 but has no production reader; repository-wide references outside its declaration are confined to provider-id-literals.test.ts. Move adapter ownership metadata to the structural-test surface or give it a genuine production consumer.; AB-18 (REMEDIABLE; plan task rem-as-built-rem-ab8-1): Verified 100% from current source: bootComposeEngineerLaunch is reached, but command, registry, config, and rendererOpts are unread; production supplies a no-op launch callback whose result is ignored, while the real spawn occurs later through launchClaudeEngineer. Collapse this to an honest validation-only helper or wire its declared boot-and-launch contract through production.; PG-3 (DESIGN; plan task rem-as-built-rem-pg1-1): Verified 99% against sealed Story 1 and current source: the remediation task requires an adapter's own displayName to remain exempt, and provider-id-literals.test.ts:82-85,178-186 enforces that exemption. This contradicts the sealed criterion requiring every user-facing provider display string to originate from the catalog; an exact literal such as 'Codex' inside the Codex adapter passes undetected.
```
